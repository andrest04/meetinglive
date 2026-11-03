// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { RecordingStatusLine } from './RecordingStatusLine';

type Listener = (payload: unknown) => void;

function installApi() {
  const listeners = new Map<string, Set<Listener>>();
  const on = (name: string, listener: Listener) => {
    const set = listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(name, set);
    return () => {
      set.delete(listener);
    };
  };
  Object.defineProperty(window, 'vozella', {
    value: { on, invoke: () => Promise.resolve({}) },
    configurable: true,
  });
  return (name: string, payload: unknown): void => {
    act(() => {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    });
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const view = (props: Partial<Parameters<typeof RecordingStatusLine>[0]> = {}) => (
  <Providers>
    <RecordingStatusLine recording paused={false} microphone appName={null} {...props} />
  </Providers>
);

describe('RecordingStatusLine', () => {
  it('names what is being recorded and follows the level', () => {
    const emit = installApi();
    render(view({ appName: 'Zoom' }));
    expect(screen.getByRole('status')).toHaveTextContent('Recording... mic + Zoom.');
    emit('audio.recording.level', { level: 55 });
    expect(screen.getByRole('meter', { name: 'Microphone level' })).toHaveAttribute(
      'aria-valuenow',
      '55',
    );
  });

  it('says the break is not recorded while paused', () => {
    installApi();
    render(view({ paused: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Paused. The break is not recorded.');
  });

  it('zeroes the level bar while paused (C4)', () => {
    const emit = installApi();
    const { rerender } = render(view());
    emit('audio.recording.level', { level: 80 });
    const meter = () => screen.getByRole('meter', { name: 'Microphone level' });
    expect(meter()).toHaveAttribute('aria-valuenow', '80');
    rerender(view({ paused: true }));
    expect(meter()).toHaveAttribute('aria-valuenow', '0');
  });

  it('keeps a lost-source warning over the plain text, also after a resume', () => {
    const emit = installApi();
    const { rerender } = render(view({ paused: true }));
    emit('audio.recording.notice', { kind: 'source-lost', source: 'Microphone', remaining: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('The microphone stopped working');
    rerender(view({ paused: false }));
    expect(screen.getByRole('status')).toHaveTextContent('The microphone stopped working');
  });

  it('never replaces "nothing left" with a milder warning that arrives later', () => {
    const emit = installApi();
    render(view());
    emit('audio.recording.notice', { kind: 'source-lost', source: 'Output', remaining: 0 });
    emit('audio.recording.notice', { kind: 'source-lost', source: 'Microphone', remaining: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('Nothing is being captured');
  });

  it('shows the error text of a failure that stops the recording', () => {
    const emit = installApi();
    render(view());
    emit('audio.recording.notice', { kind: 'faulted', message: 'disk full' });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Recording stopped because of an audio error: disk full.',
    );
  });

  it('draws nothing when no recording runs, and the bar rests with no microphone', () => {
    installApi();
    const { container, rerender } = render(view({ recording: false }));
    expect(container).toBeEmptyDOMElement();
    rerender(view({ microphone: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Recording... system audio only.');
  });
});
