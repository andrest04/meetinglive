// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTakeNotesRequest } from './use-take-notes';

type Listener = (payload: unknown) => void;

function install(options: {
  pending: boolean;
  calendarEventId?: string | null;
  recordingPhase?: string;
}) {
  const consumed = vi.fn();
  // Like main: a request is remembered once and cleared when consumed.
  let pending = options.pending;
  const listeners = new Set<Listener>();
  const invoke = vi.fn((name: string) => {
    if (name === 'workspace.dispatch') {
      consumed();
      const wasPending = pending;
      pending = false;
      return Promise.resolve({
        state: {},
        takeNotes: { pending: wasPending, calendarEventId: options.calendarEventId ?? null },
      });
    }
    if (name === 'recording.getState') {
      return Promise.resolve({ phase: options.recordingPhase ?? 'Idle' });
    }
    return Promise.resolve({});
  });
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke,
      on: (name: string, listener: Listener) => {
        if (name === 'workspace.takeNotesRequested') listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    consumed,
    request: () => {
      pending = true;
    },
    emit: () => {
      listeners.forEach((listener) => {
        listener({});
      });
    },
  };
}

const visibility = (value: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
};

afterEach(() => {
  cleanup();
  visibility('visible');
  Reflect.deleteProperty(window, 'vozella');
});

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('useTakeNotesRequest (items 93, 94, 96)', () => {
  it('R17: a request remembered before the page opened starts a take on mount', async () => {
    install({ pending: true });
    const start = vi.fn();
    renderHook(() => useTakeNotesRequest(true, start));
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('nothing pending starts nothing', async () => {
    install({ pending: false });
    const start = vi.fn();
    renderHook(() => useTakeNotesRequest(true, start));
    await flush();
    expect(start).not.toHaveBeenCalled();
  });

  it('R18: the live event is ignored while the page is not visible, and consumed on return', async () => {
    const api = install({ pending: true });
    const start = vi.fn();
    visibility('hidden');
    renderHook(() => useTakeNotesRequest(true, start));
    await flush();
    const afterMount = api.consumed.mock.calls.length;
    start.mockClear();
    api.request();
    act(() => {
      api.emit();
    });
    await flush();
    expect(api.consumed.mock.calls.length).toBe(afterMount);
    visibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(api.consumed.mock.calls.length).toBe(afterMount + 1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('R18: the live event on a visible page consumes and starts', async () => {
    const api = install({ pending: true });
    const start = vi.fn();
    renderHook(() => useTakeNotesRequest(true, start));
    await flush();
    start.mockClear();
    api.request();
    act(() => {
      api.emit();
    });
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it.each(['starting or recording', 'processing'])(
    'R20: no take starts while the page is busy (%s), and the request is still consumed',
    async () => {
      const api = install({ pending: true });
      const start = vi.fn();
      renderHook(() => useTakeNotesRequest(false, start));
      await flush();
      expect(api.consumed).toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    },
  );

  it('R20: no take starts when main says one is already running', async () => {
    install({ pending: true, recordingPhase: 'Recording' });
    const start = vi.fn();
    renderHook(() => useTakeNotesRequest(true, start));
    await flush();
    expect(start).not.toHaveBeenCalled();
  });

  it('R19 stays dropped: a request that carries an event id is ignored', async () => {
    install({ pending: true, calendarEventId: 'evt-1' });
    const start = vi.fn();
    renderHook(() => useTakeNotesRequest(true, start));
    await flush();
    expect(start).not.toHaveBeenCalled();
  });
});
