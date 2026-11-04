// @vitest-environment jsdom
import type { RecordingStateDto } from '@vozella/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { RecordingSession, type RecordingSessionProps } from './RecordingSession';

type Listener = (payload: unknown) => void;
type Handler = (input: Record<string, unknown>) => unknown;

const recording: RecordingStateDto = {
  phase: 'Recording',
  isRecording: true,
  isPaused: false,
  isProcessing: false,
  elapsedMs: 65_000,
  elapsedAsOfMs: Date.now(),
  isTicking: true,
  status: [],
  micLevel: 0,
  captureNotices: [],
  meetingId: 'm1',
  title: 'Weekly sync',
  recordedAtMs: 1,
  highlightCount: 0,
  notes: '',
  canRetry: false,
  lastMeeting: null,
};

function installApi(overrides: Record<string, Handler> = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const handlers: Record<string, Handler> = {
    'recording.stop': () => ({ stopped: true }),
    'recording.pause': () => ({ paused: true }),
    'recording.resume': () => ({ resumed: true }),
    'recording.discard': () => ({ discarded: true }),
    'recording.highlight': () => ({ marked: true, elapsedMs: 12_340 }),
    'summaries.writeClipboard': () => ({ status: 'written' }),
    ...overrides,
  };
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke: (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input });
        return Promise.resolve(handlers[name]?.(input) ?? {});
      },
      on: (name: string, listener: Listener) => {
        const set = listeners.get(name) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(name, set);
        return () => {
          set.delete(listener);
        };
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    named: (name: string) => calls.filter((c) => c.name === name),
    emit: (name: string, payload: unknown) => {
      act(() => {
        for (const l of listeners.get(name) ?? []) l(payload);
      });
    },
  };
}

const props: RecordingSessionProps = {
  state: recording,
  liveText: '[00:00.00-00:02.00] Hola a todos',
  committedText: '[00:00.00-00:02.00] Hola a todos',
  destination: 'Clients / Acme',
  sources: 'Mic: System default · Audio: All system audio',
  statusText: '',
  emptyText: 'Live preview only.',
  side: null,
  sideBySide: true,
};

const mount = (override: Partial<RecordingSessionProps> = {}) => {
  const view = render(
    <Providers>
      <RecordingSession {...props} {...override} />
    </Providers>,
  );
  return {
    ...view,
    again: (next: Partial<RecordingSessionProps>) => {
      view.rerender(
        <Providers>
          <RecordingSession {...props} {...override} {...next} />
        </Providers>,
      );
    },
  };
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'vozella');
});

describe('the recording bar content (items 50, 62)', () => {
  it('shows the elapsed time by name, the title and the sources summary', () => {
    installApi();
    mount();
    expect(screen.getByRole('timer', { name: 'Elapsed recording time' })).toHaveTextContent(
      /^01:0[5-9]$/,
    );
    expect(screen.getByTestId('bar-title')).toHaveTextContent('Weekly sync');
    expect(screen.getByTestId('bar-sources')).toHaveTextContent(
      'Mic: System default · Audio: All system audio',
    );
  });

  it('puts the destination in the title tooltip', async () => {
    installApi();
    mount();
    await userEvent.hover(screen.getByTestId('bar-title'));
    expect(await screen.findByText('Clients / Acme')).toBeVisible();
  });

  it('tabs through Stop, Pause, Highlight, Copy, Discard in that order', async () => {
    installApi();
    mount();
    const bar = screen.getByTestId('recording-bar');
    const order = within(bar)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(order).toEqual(['Stop', 'Pause', 'Highlight', 'Copy', 'Discard']);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveFocus();
  });

  it('names the highlight tooltip and the accelerators', async () => {
    installApi();
    mount();
    await userEvent.hover(screen.getByRole('button', { name: 'Highlight' }));
    expect(await screen.findByText('Star this moment in the transcript')).toBeVisible();
    await userEvent.hover(screen.getByRole('button', { name: 'Stop' }));
    const tooltip = (await screen.findByText('Ctrl')).closest('span.gap-2');
    expect(tooltip?.textContent).toBe('StopCtrl+R');
    expect([...(tooltip?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent)).toEqual([
      'Ctrl',
      'R',
    ]);
  });
});

describe('level meter (items 101, 102, B-13, B-14, B-15)', () => {
  it('is named for what it measures: the recording, not the microphone (B-13)', () => {
    installApi();
    mount();
    expect(screen.getByRole('meter', { name: 'Recording level' })).toBeVisible();
    expect(screen.queryByRole('meter', { name: 'Microphone level' })).toBeNull();
  });

  it('shows the level from the audio worker as sent, on the one dB scale (B-14)', () => {
    const api = installApi();
    mount();
    api.emit('audio.recording.level', { level: 56 });
    expect(screen.getByRole('meter', { name: 'Recording level' })).toHaveAttribute(
      'aria-valuenow',
      '56',
    );
  });

  it('drops to zero while paused and does not freeze on the last value (B-15)', () => {
    const api = installApi();
    const view = mount();
    api.emit('audio.recording.level', { level: 70 });
    view.again({ state: { ...recording, isPaused: true, isTicking: false } });
    expect(screen.getByRole('meter', { name: 'Recording level' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    view.again({ state: recording });
    expect(screen.getByRole('meter', { name: 'Recording level' })).toHaveAttribute(
      'aria-valuenow',
      '70',
    );
  });
});

describe('the buttons', () => {
  it('Stop and Pause call main, and Resume replaces Pause while paused', async () => {
    const api = installApi();
    const view = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(api.named('recording.pause')).toHaveLength(1);
    view.again({ state: { ...recording, isPaused: true, isTicking: false } });
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(api.named('recording.resume')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(api.named('recording.stop')).toHaveLength(1);
  });

  it('shows the LIVE badge while recording and hides it while paused (item 64)', () => {
    installApi();
    const view = mount();
    expect(screen.getByTestId('live-badge')).toBeVisible();
    view.again({ state: { ...recording, isPaused: true, isTicking: false } });
    expect(screen.queryByTestId('live-badge')).toBeNull();
  });

  it('disables the buttons once a stop is running', () => {
    installApi();
    mount({ state: { ...recording, phase: 'Stopping' } });
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });
});

describe('Highlight feedback (item 68)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('says Highlighted mm:ss.ff and clears after 2 s, restarting on every press', async () => {
    const api = installApi();
    mount();
    const feedback = screen.getByTestId('highlight-feedback');
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    await flush();
    expect(api.named('recording.highlight')).toHaveLength(1);
    expect(feedback).toHaveTextContent('Highlighted 00:12.34');
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(feedback).toHaveTextContent('Highlighted');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(feedback).toBeEmptyDOMElement();
  });

  it('stays quiet when main did not mark anything', async () => {
    installApi({ 'recording.highlight': () => ({ marked: false, elapsedMs: 0 }) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    await flush();
    expect(screen.getByTestId('highlight-feedback')).toBeEmptyDOMElement();
  });

  it('is available while paused', () => {
    installApi();
    mount({ state: { ...recording, isPaused: true, isTicking: false } });
    expect(screen.getByRole('button', { name: 'Highlight' })).toBeEnabled();
  });
});

describe('Copy (item 70)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('copies the canvas text through main and shows Copied for 2.5 s, restartable', async () => {
    const api = installApi();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(api.named('summaries.writeClipboard')[0]?.input).toEqual({
      text: '[00:00.00-00:02.00] Hola a todos',
    });
    expect(screen.getByText('Transcript copied to the clipboard.')).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Transcript copied to the clipboard.')).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText('Transcript copied to the clipboard.')).toBeNull();
  });

  it('is disabled when there is no text', () => {
    installApi();
    mount({ liveText: '', committedText: '' });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('shows nothing when the clipboard write failed', async () => {
    installApi({ 'summaries.writeClipboard': () => ({ status: 'failed', detail: 'no' }) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await flush();
    expect(screen.queryByText('Transcript copied to the clipboard.')).toBeNull();
  });
});

describe('Discard (item 71)', () => {
  it('asks first, defaults to Keep recording and discards nothing on Keep', async () => {
    const api = installApi();
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard this recording?' });
    expect(within(dialog).getByText('The audio is deleted. Nothing is saved.')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Keep recording' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep recording' }));
    expect(api.named('recording.discard')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape keeps the take', async () => {
    const api = installApi();
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(api.named('recording.discard')).toHaveLength(0);
  });

  it('discards only on the primary button', async () => {
    const api = installApi();
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(api.named('recording.discard')).toHaveLength(1);
  });

  it('does not discard a take that ended while the dialog was open', async () => {
    const api = installApi();
    const view = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('dialog');
    view.again({ state: { ...recording, phase: 'Stopping' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(api.named('recording.discard')).toHaveLength(0);
  });
});

describe('accelerators on the page (spec 2.6)', () => {
  it('Ctrl+R stops, Ctrl+P pauses, Ctrl+Shift+D asks to discard', async () => {
    const api = installApi();
    mount();
    fireEvent.keyDown(document, { key: 'p', ctrlKey: true });
    expect(api.named('recording.pause')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    expect(api.named('recording.stop')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'D', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Discard this recording?' })).toBeVisible();
    expect(api.named('recording.discard')).toHaveLength(0);
  });

  it('swallows the keys but does nothing once a stop is running', () => {
    const api = installApi();
    mount({ state: { ...recording, phase: 'Stopping' } });
    const event = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(api.named('recording.stop')).toHaveLength(0);
  });

  it('is gone with the bar', () => {
    const api = installApi();
    const view = mount();
    view.unmount();
    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    expect(api.named('recording.stop')).toHaveLength(0);
  });
});

describe('the pulse (items 63, 193)', () => {
  it('pulses while recording and rests while paused', () => {
    installApi();
    const view = mount();
    expect(screen.getByTestId('pulse')).toHaveAttribute('data-active', 'true');
    view.again({ state: { ...recording, isPaused: true, isTicking: false } });
    expect(screen.getByTestId('pulse')).toHaveAttribute('data-active', 'false');
  });
});
