// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { RecordRoute } from './RecordRoute';

type Listener = (payload: unknown) => void;

const system = { processId: null, app: null, isAvailable: true, level: 0 };
const pickerState = {
  cards: [system],
  selectedProcessId: null,
  noAppsPlaying: true,
  suggestion: null,
  fallbackAppName: null,
};

function installApi(overrides: Record<string, (input: Record<string, unknown>) => unknown> = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const handlers: Record<string, (input: Record<string, unknown>) => unknown> = {
    'audio.microphones.load': () => ({
      options: [
        { kind: 'None', deviceId: null, name: null },
        { kind: 'SystemDefault', deviceId: null, name: null },
      ],
      selected: { kind: 'SystemDefault', deviceId: null },
    }),
    'audio.sources.start': () => pickerState,
    'audio.recording.start': () => ({ started: true, recordedAtMs: 1 }),
    'audio.recording.pause': () => ({ paused: true }),
    'audio.recording.resume': () => ({ resumed: true }),
    'audio.recording.stop': () => ({
      path: 'C:\\Lib\\Inbox\\2026-05-03 Weekly.wav',
      recordedAtMs: 1,
      pausedSeconds: 0,
      error: null,
    }),
    ...overrides,
  };
  const invoke = (name: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, input });
    return Promise.resolve(handlers[name]?.(input) ?? {});
  };
  const on = (name: string, listener: Listener) => {
    const set = listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(name, set);
    return () => {
      set.delete(listener);
    };
  };
  Object.defineProperty(window, 'vozella', {
    value: { invoke, on },
    configurable: true,
    writable: true,
  });
  const emit = (name: string, payload: unknown): void => {
    act(() => {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    });
  };
  return { calls, emit };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = () =>
  render(
    <Providers>
      <RecordRoute />
    </Providers>,
  );

describe('RecordRoute take', () => {
  it('records with the typed title, shows the status line and the live level, and stops', async () => {
    const api = installApi();
    mount();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Title' }), 'Weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    const status = await screen.findByTestId('recording-status');
    expect(status).toHaveTextContent('Recording... mic + system audio.');
    expect(api.calls.find((c) => c.name === 'audio.recording.start')?.input).toEqual({
      title: 'Weekly',
      microphone: { kind: 'SystemDefault', deviceId: null },
    });
    expect(screen.queryByRole('button', { name: 'Import audio' })).toBeNull();

    api.emit('audio.recording.level', { level: 64 });
    expect(screen.getByRole('meter', { name: 'Microphone level' })).toHaveAttribute(
      'aria-valuenow',
      '64',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(screen.queryByTestId('recording-status')).toBeNull();
    });
    expect(screen.getByText('Saved as 2026-05-03 Weekly.wav in the Inbox.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
  });

  it('pauses with the paused text, keeps a lost-source warning across pause and resume', async () => {
    const api = installApi();
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Record' }));
    await screen.findByTestId('recording-status');

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByTestId('recording-status')).toHaveTextContent(
      'Paused. The break is not recorded.',
    );
    api.emit('audio.recording.notice', { kind: 'source-lost', source: 'Microphone', remaining: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pause' })).toBeVisible();
    });
    expect(screen.getByTestId('recording-status')).not.toHaveTextContent(/^Recording/);
    expect(screen.getByTestId('recording-status').textContent).toMatch(/microphone/i);
  });

  it('shows the start failure and keeps the Record button (items 39, 60)', async () => {
    installApi({
      'audio.recording.start': () => ({ started: false, code: null, message: 'no device' }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Record' }));
    expect(await screen.findByText('Error: could not start recording (no device).')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
  });

  it('shows the stop failure', async () => {
    installApi({
      'audio.recording.stop': () => ({
        path: 'C:\\x.wav',
        recordedAtMs: 1,
        pausedSeconds: 0,
        error: 'disk full',
      }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Record' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Error stopping the recording: disk full')).toBeVisible();
  });

  it('imports audio from the page and shows the result (items 148, 149)', async () => {
    const api = installApi({
      'audio.import.pickFile': () => ({ path: 'C:\\in\\call.mp3', recordedAtMs: 5 }),
      'audio.import.run': () => ({
        imported: true,
        path: 'C:\\Lib\\Inbox\\Call.wav',
        recordedAtMs: 5,
        endedAtMs: 9,
        durationSeconds: 0.004,
      }),
    });
    mount();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Title' }), 'Call');
    await userEvent.click(screen.getByRole('button', { name: 'Import audio' }));
    expect(await screen.findByText('Saved as Call.wav in the Inbox.')).toBeVisible();
    expect(api.calls.find((c) => c.name === 'audio.import.run')?.input).toEqual({ title: 'Call' });
  });

  it('shows the import error', async () => {
    installApi({
      'audio.import.pickFile': () => ({ path: 'C:\\in\\call.mp3', recordedAtMs: 5 }),
      'audio.import.run': () => ({ imported: false, message: 'bad codec' }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Import audio' }));
    expect(await screen.findByText("Error: couldn't import that audio (bad codec).")).toBeVisible();
  });

  it('stops the idle level and the poller while recording', async () => {
    const api = installApi();
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Record' }));
    await screen.findByTestId('recording-status');
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'audio.sources.stop')).toBe(true);
    });
  });
});
