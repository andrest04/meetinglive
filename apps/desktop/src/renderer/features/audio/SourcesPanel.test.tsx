// @vitest-environment jsdom
import type { SourcePickerStateDto } from '@vozella/contracts';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { SourcesPanel } from './SourcesPanel';

type Listener = (payload: unknown) => void;

const app = (processId: number, friendlyName: string, extra: object = {}) => ({
  processId,
  exePath: `C:\\apps\\${friendlyName}.exe`,
  friendlyName,
  isBrowser: false,
  isKnownMeetingApp: false,
  peak: 0,
  ...extra,
});

const system = { processId: null, app: null, isAvailable: true, level: 0 };

function pickerState(extra: Partial<SourcePickerStateDto> = {}): SourcePickerStateDto {
  return {
    cards: [system],
    selectedProcessId: null,
    noAppsPlaying: true,
    suggestion: null,
    fallbackAppName: null,
    ...extra,
  };
}

interface FakeOptions {
  devices?: { id: string; name: string }[];
  state?: SourcePickerStateDto;
  failLoad?: boolean;
  /** Icons by executable name; anything else has none. */
  icons?: Record<string, string>;
}

function installApi(options: FakeOptions = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<Listener>>();
  let state = options.state ?? pickerState();
  const devices = options.devices ?? [
    { id: 'mic-1', name: 'Test microphone' },
    { id: 'mic-2', name: 'Test headset' },
  ];
  const optionList = () => [
    { kind: 'None', deviceId: null, name: null },
    { kind: 'SystemDefault', deviceId: null, name: null },
    ...devices.map((d) => ({ kind: 'Device', deviceId: d.id, name: d.name })),
  ];
  const invoke = (name: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, input });
    switch (name) {
      case 'audio.microphones.load': {
        if (options.failLoad) return Promise.reject(new Error('no devices'));
        const choice = input.userChoice as { kind: string; deviceId: string | null } | null;
        const gone = choice?.kind === 'Device' && !devices.some((d) => d.id === choice.deviceId);
        return Promise.resolve({
          options: optionList(),
          selected: gone || !choice ? { kind: 'SystemDefault', deviceId: null } : choice,
        });
      }
      case 'audio.apps.icon': {
        const exe = String(input.exePath);
        const key = Object.keys(options.icons ?? {}).find((name) => exe.includes(name));
        return Promise.resolve({ dataUrl: key ? (options.icons?.[key] ?? null) : null });
      }
      case 'audio.microphones.remember':
        return Promise.resolve({ saved: true });
      case 'audio.sources.start':
        return Promise.resolve(state);
      case 'audio.sources.select': {
        const processId = input.processId as number | null;
        state = { ...state, selectedProcessId: processId, fallbackAppName: null };
        return Promise.resolve(state);
      }
      case 'audio.sources.dismissSuggestion':
        state = { ...state, suggestion: null };
        return Promise.resolve(state);
      case 'audio.sources.closeFallback':
        state = { ...state, fallbackAppName: null };
        return Promise.resolve(state);
      default:
        return Promise.resolve({});
    }
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
  return { calls, emit, devices };
}

const names = (calls: { name: string }[]): string[] => calls.map((call) => call.name);

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('SourcesPanel microphone', () => {
  it('lists None, System default and the devices, and remembers a pick', async () => {
    const api = installApi();
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Microphone' });
    await waitFor(() => {
      expect(combo).toHaveTextContent('System default');
    });
    await userEvent.click(combo);
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(labels).toEqual(['None', 'System default', 'Test microphone', 'Test headset']);
    await userEvent.click(screen.getByRole('option', { name: 'Test headset' }));
    await waitFor(() => {
      expect(combo).toHaveTextContent('Test headset');
    });
    expect(api.calls.find((c) => c.name === 'audio.microphones.remember')?.input).toEqual({
      choice: { kind: 'Device', deviceId: 'mic-2' },
    });
    expect(screen.getByTestId('sources-summary')).toHaveTextContent(
      'Mic: Test headset · Audio: All system audio',
    );
  });

  it('reloads the devices when the dropdown opens, keeping the user choice', async () => {
    const api = installApi();
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Microphone' });
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'Test microphone' }));
    const loadsBefore = api.calls.filter((c) => c.name === 'audio.microphones.load').length;
    await userEvent.click(combo);
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'audio.microphones.load').length).toBe(
        loadsBefore + 1,
      );
    });
    const last = api.calls.filter((c) => c.name === 'audio.microphones.load').at(-1);
    expect(last?.input).toEqual({ userChoice: { kind: 'Device', deviceId: 'mic-1' } });
  });

  it('keeps only None and System default when the list cannot load', async () => {
    installApi({ failLoad: true });
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Microphone' });
    await waitFor(() => {
      expect(combo).toHaveTextContent('System default');
    });
    await userEvent.click(combo);
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(labels).toEqual(['None', 'System default']);
  });

  it('102: a picked device falls back to System default when a later load fails', async () => {
    const options: FakeOptions = {};
    installApi(options);
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Microphone' });
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'Test microphone' }));
    await waitFor(() => {
      expect(combo).toHaveTextContent('Test microphone');
    });
    options.failLoad = true;
    await userEvent.click(combo);
    await waitFor(() => {
      expect(combo).toHaveTextContent('System default');
    });
    expect(screen.getByTestId('sources-summary')).toHaveTextContent('Mic: System default');
  });

  it('93: the preview starts again when the panel goes idle again after a take', async () => {
    const api = installApi();
    const view = (active: boolean) => (
      <Providers>
        <SourcesPanel active={active} />
      </Providers>
    );
    const { rerender } = render(view(true));
    const starts = () => api.calls.filter((c) => c.name === 'audio.preview.start').length;
    await waitFor(() => {
      expect(starts()).toBe(1);
    });
    rerender(view(false));
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'audio.preview.stop').length).toBeGreaterThan(0);
    });
    rerender(view(true));
    await waitFor(() => {
      expect(starts()).toBe(2);
    });
  });

  it('runs the idle level while a microphone is chosen and stops it on None', async () => {
    const api = installApi();
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    await waitFor(() => {
      expect(names(api.calls)).toContain('audio.preview.start');
    });
    expect(api.calls.find((c) => c.name === 'audio.preview.start')?.input).toEqual({
      deviceId: null,
    });
    api.emit('audio.preview.level', { level: 42 });
    expect(screen.getByRole('meter', { name: 'Microphone level' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    const combo = screen.getByRole('combobox', { name: 'Microphone' });
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'None' }));
    await waitFor(() => {
      expect(names(api.calls)).toContain('audio.preview.stop');
    });
    expect(screen.getByRole('meter', { name: 'Microphone level' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });
});

describe('SourcesPanel meeting audio', () => {
  const playing = pickerState({
    cards: [
      system,
      {
        processId: 10,
        app: app(10, 'Zoom', { isKnownMeetingApp: true }),
        isAvailable: true,
        level: 30,
      },
      { processId: 11, app: app(11, 'Chrome', { isBrowser: true }), isAvailable: true, level: 5 },
      { processId: 12, app: app(12, 'Teams'), isAvailable: false, level: 0 },
    ],
    noAppsPlaying: false,
  });

  it('draws the system card, app tags and the not playing card, and selects an app', async () => {
    const api = installApi({ state: playing });
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    const group = await screen.findByRole('radiogroup', { name: 'Meeting audio' });
    await waitFor(() => {
      expect(screen.getAllByRole('radio')).toHaveLength(4);
    });
    expect(group).toHaveTextContent('Detected');
    expect(group).toHaveTextContent('Records all tabs');
    expect(group).toHaveTextContent('Not playing');
    expect(screen.queryByText('Play audio in your meeting app to pick it here')).toBeNull();
    expect(screen.getByRole('radio', { name: /All system audio/ })).toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: /Zoom/ }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Zoom/ })).toBeChecked();
    });
    expect(api.calls.find((c) => c.name === 'audio.sources.select')?.input).toEqual({
      processId: 10,
    });
    expect(screen.getByTestId('sources-summary')).toHaveTextContent('Audio: Zoom');
  });

  it('draws the icon of each app executable and keeps the glyph where there is none (item 131)', async () => {
    const api = installApi({ state: playing, icons: { Zoom: 'data:image/png;base64,AAAA' } });
    const { container } = render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    await waitFor(() => {
      expect(container.querySelectorAll('img[src^="data:image/png"]')).toHaveLength(1);
    });
    const zoom = screen.getByRole('radio', { name: /Zoom/ });
    expect(zoom.closest('label, div')?.querySelector('img')).not.toBeNull();
    const asked = api.calls.filter((c) => c.name === 'audio.apps.icon').map((c) => c.input);
    expect(asked).toContainEqual({ exePath: String.raw`C:\apps\Zoom.exe` });
    expect(asked).toContainEqual({ exePath: String.raw`C:\apps\Chrome.exe` });
  });

  it('locks the choices while a take runs', async () => {
    installApi({ state: playing });
    const { container } = render(
      <Providers>
        <SourcesPanel active={false} locked />
      </Providers>,
    );
    await screen.findByRole('combobox', { name: 'Microphone', hidden: true });
    expect(container.querySelector('[inert]')).not.toBeNull();
  });

  it('shows no meter readings and no offers while a take runs', async () => {
    installApi({
      state: { ...playing, suggestion: app(10, 'Zoom', { isKnownMeetingApp: true }) },
    });
    const view = (active: boolean, locked: boolean) => (
      <Providers>
        <SourcesPanel active={active} locked={locked} />
      </Providers>
    );
    const { rerender } = render(view(true, false));
    expect(await screen.findByText('Zoom is in a call')).toBeVisible();
    rerender(view(false, true));
    expect(screen.queryByText('Zoom is in a call')).toBeNull();
    const meters = screen.getAllByRole('meter', { hidden: true });
    expect(meters.length).toBeGreaterThan(0);
    for (const meter of meters) expect(meter).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows the empty hint when no app plays', async () => {
    installApi();
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    expect(await screen.findByText('Play audio in your meeting app to pick it here')).toBeVisible();
  });

  it('follows the meters pushed by main', async () => {
    const api = installApi({ state: playing });
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    await screen.findByRole('radio', { name: /Zoom/ });
    api.emit('audio.sources.changed', {
      ...playing,
      cards: playing.cards.map((c) => (c.processId === 10 ? { ...c, level: 77 } : c)),
    });
    expect(screen.getByRole('meter', { name: 'Zoom' })).toHaveAttribute('aria-valuenow', '77');
  });

  it('133: a card keeps its DOM node when the list is refreshed and reordered', async () => {
    const api = installApi({ state: playing });
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    const zoom = await screen.findByRole('radio', { name: /Zoom/ });
    const extra = {
      processId: 99,
      app: app(99, 'Chrome'),
      isAvailable: true,
      level: 5,
    };
    const [first, ...rest] = playing.cards;
    api.emit('audio.sources.changed', { ...playing, cards: [first, extra, ...rest] });
    await screen.findAllByRole('radio', { name: /Chrome/ });
    expect(screen.getByRole('radio', { name: /Zoom/ })).toBe(zoom);
    api.emit('audio.sources.changed', { ...playing, cards: [first, ...rest, extra].reverse() });
    expect(screen.getByRole('radio', { name: /Zoom/ })).toBe(zoom);
  });

  it('offers the suggested app and remembers dismissal', async () => {
    const api = installApi({
      state: { ...playing, suggestion: app(10, 'Zoom', { isKnownMeetingApp: true }) },
    });
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    expect(await screen.findByText('Zoom is in a call')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Use Zoom' }));
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Zoom/ })).toBeChecked();
    });
    expect(api.calls.find((c) => c.name === 'audio.sources.select')?.input).toEqual({
      processId: 10,
    });
  });

  it('dismisses the suggestion with its close button', async () => {
    const api = installApi({
      state: { ...playing, suggestion: app(10, 'Zoom', { isKnownMeetingApp: true }) },
    });
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    await screen.findByText('Zoom is in a call');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Zoom is in a call')).toBeNull();
    });
    expect(api.calls.find((c) => c.name === 'audio.sources.dismissSuggestion')?.input).toEqual({
      processId: 10,
    });
  });

  it('explains a fallback to all system audio and closes it', async () => {
    const api = installApi({ state: { ...playing, fallbackAppName: 'Teams' } });
    render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    expect(await screen.findByText('Audio source changed')).toBeVisible();
    expect(
      screen.getByText('Teams is no longer running. Recording all system audio instead.'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Audio source changed')).toBeNull();
    });
    expect(names(api.calls)).toContain('audio.sources.closeFallback');
  });

  it('136: shows the fallback published as the take starts, and the user can close it', async () => {
    const api = installApi();
    const view = (active: boolean, locked: boolean) => (
      <Providers>
        <SourcesPanel active={active} locked={locked} />
      </Providers>
    );
    const { rerender } = render(view(true, false));
    await waitFor(() => {
      expect(names(api.calls)).toContain('audio.sources.start');
    });
    // Record is pressed: the page locks, and main publishes the state with the fallback.
    rerender(view(false, true));
    api.emit('audio.sources.changed', pickerState({ fallbackAppName: 'Teams' }));
    expect(await screen.findByText('Audio source changed')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Audio source changed')).toBeNull();
    });
    expect(names(api.calls)).toContain('audio.sources.closeFallback');
  });

  it('stops the poller and the preview when the page goes away', async () => {
    const api = installApi();
    const view = render(
      <Providers>
        <SourcesPanel active />
      </Providers>,
    );
    await waitFor(() => {
      expect(names(api.calls)).toContain('audio.sources.start');
    });
    view.unmount();
    expect(names(api.calls)).toContain('audio.sources.stop');
    expect(names(api.calls)).toContain('audio.preview.stop');
  });
});
