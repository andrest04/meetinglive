import { describe, expect, it, vi } from 'vitest';
import type { SavedWindowState } from '@vozella/core';
import {
  loadWindowPlacement,
  trackWindowState,
  WINDOW_STATE_SAVE_DEBOUNCE_MS,
  type TrackedWindow,
  type WindowStateEvent,
} from './window-state';

function fakeWindow(initial = { x: 10, y: 20, width: 1200, height: 800 }) {
  const listeners = new Map<WindowStateEvent, () => void>();
  const state = { bounds: initial, maximized: false, destroyed: false };
  const window: TrackedWindow = {
    isDestroyed: () => state.destroyed,
    isMaximized: () => state.maximized,
    getNormalBounds: () => state.bounds,
    on: (event, listener) => {
      listeners.set(event, listener);
    },
  };
  return { window, state, emit: (event: WindowStateEvent) => listeners.get(event)?.() };
}

function fakeTimers() {
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    setTimeout: (callback: () => void) => {
      queue.set(next, callback);
      return next++;
    },
    clearTimeout: (handle: unknown) => {
      queue.delete(handle as number);
    },
    fireAll: () => {
      for (const [id, callback] of [...queue]) {
        queue.delete(id);
        callback();
      }
    },
    pending: () => queue.size,
  };
}

describe('trackWindowState', () => {
  it('debounces a burst of resizes into one save of the normal bounds', () => {
    const { window, emit } = fakeWindow();
    const timers = fakeTimers();
    const save = vi.fn(() => Promise.resolve());
    trackWindowState(window, { save }, null, timers);
    emit('resize');
    emit('resize');
    emit('move');
    expect(save).not.toHaveBeenCalled();
    expect(timers.pending()).toBe(1);
    timers.fireAll();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
      maximized: false,
    } satisfies SavedWindowState);
  });

  it('saves the maximized flag with the restored bounds', () => {
    const { window, state, emit } = fakeWindow();
    const timers = fakeTimers();
    const save = vi.fn(() => Promise.resolve());
    trackWindowState(window, { save }, null, timers);
    state.maximized = true;
    emit('maximize');
    timers.fireAll();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ maximized: true, width: 1200 }));
  });

  it('saves at once on close and drops the pending debounce', () => {
    const { window, emit } = fakeWindow();
    const timers = fakeTimers();
    const save = vi.fn(() => Promise.resolve());
    trackWindowState(window, { save }, null, timers);
    emit('resize');
    emit('close');
    expect(save).toHaveBeenCalledTimes(1);
    expect(timers.pending()).toBe(0);
  });

  it('does not touch a destroyed window', () => {
    const { window, state, emit } = fakeWindow();
    const timers = fakeTimers();
    const save = vi.fn(() => Promise.resolve());
    trackWindowState(window, { save }, null, timers);
    emit('resize');
    state.destroyed = true;
    timers.fireAll();
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the opened size when the window reads a pixel or two off (no growth per launch)', () => {
    const { window, state, emit } = fakeWindow({ x: 10, y: 20, width: 1202, height: 801 });
    const timers = fakeTimers();
    const save = vi.fn(() => Promise.resolve());
    trackWindowState(window, { save }, { x: 10, y: 20, width: 1200, height: 800 }, timers);
    emit('close');
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ width: 1200, height: 800, maximized: false }),
    );
    state.bounds = { x: 10, y: 20, width: 1400, height: 801 };
    emit('close');
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1400, height: 800 }));
  });

  it('waits half a second by default', () => {
    expect(WINDOW_STATE_SAVE_DEBOUNCE_MS).toBe(500);
  });
});

describe('loadWindowPlacement', () => {
  const screen = {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
  };

  it('uses the defaults without a saved state', async () => {
    const placement = await loadWindowPlacement({ load: () => Promise.resolve(null) }, screen);
    expect(placement.bounds).toEqual({ width: 1180, height: 760 });
  });

  it('places the saved window on a visible display', async () => {
    const saved = { x: 100, y: 80, width: 1300, height: 820, maximized: true };
    const placement = await loadWindowPlacement({ load: () => Promise.resolve(saved) }, screen);
    expect(placement).toEqual({
      bounds: { x: 100, y: 80, width: 1300, height: 820 },
      maximized: true,
    });
  });
});
