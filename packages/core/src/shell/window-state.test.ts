import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  resolveWindowPlacement,
  sanitizeWindowState,
  steadyWindowState,
  WINDOW_ROUNDING_TOLERANCE,
} from './window-state';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 1280, height: 984 };

describe('sanitizeWindowState', () => {
  it('keeps a complete state', () => {
    expect(
      sanitizeWindowState({ x: 10, y: 20, width: 1200, height: 800, maximized: true }),
    ).toEqual({ x: 10, y: 20, width: 1200, height: 800, maximized: true });
  });

  it('treats a missing or odd maximized flag as false', () => {
    expect(sanitizeWindowState({ x: 0, y: 0, width: 1000, height: 700 })?.maximized).toBe(false);
    expect(
      sanitizeWindowState({ x: 0, y: 0, width: 1000, height: 700, maximized: 'yes' })?.maximized,
    ).toBe(false);
  });

  it('rounds fractional values', () => {
    expect(
      sanitizeWindowState({ x: 10.4, y: 20.6, width: 1200.5, height: 800.2, maximized: false }),
    ).toEqual({ x: 10, y: 21, width: 1201, height: 800, maximized: false });
  });

  it.each([null, undefined, 5, 'x', [], {}])('rejects %j', (raw) => {
    expect(sanitizeWindowState(raw)).toBeNull();
  });

  it('rejects non-finite or non-numeric fields', () => {
    expect(sanitizeWindowState({ x: Number.NaN, y: 0, width: 1000, height: 700 })).toBeNull();
    expect(sanitizeWindowState({ x: 0, y: 0, width: '1000', height: 700 })).toBeNull();
    expect(sanitizeWindowState({ x: 0, y: Infinity, width: 1000, height: 700 })).toBeNull();
  });

  it('rejects a size under the minimum', () => {
    const base = { x: 0, y: 0, maximized: false };
    expect(
      sanitizeWindowState({ ...base, width: MIN_WINDOW_SIZE.width - 1, height: 800 }),
    ).toBeNull();
    expect(
      sanitizeWindowState({ ...base, width: 1200, height: MIN_WINDOW_SIZE.height - 1 }),
    ).toBeNull();
    expect(
      sanitizeWindowState({
        ...base,
        width: MIN_WINDOW_SIZE.width,
        height: MIN_WINDOW_SIZE.height,
      }),
    ).not.toBeNull();
  });
});

describe('resolveWindowPlacement', () => {
  it('uses the defaults and lets the OS place the window when nothing is saved', () => {
    expect(resolveWindowPlacement(null, [primary])).toEqual({
      bounds: { width: DEFAULT_WINDOW_SIZE.width, height: DEFAULT_WINDOW_SIZE.height },
      maximized: false,
    });
  });

  it('uses the defaults when the saved state is invalid', () => {
    expect(resolveWindowPlacement({ width: 10 }, [primary]).bounds).toEqual(DEFAULT_WINDOW_SIZE);
  });

  it('keeps a saved state that is fully visible', () => {
    const saved = { x: 100, y: 50, width: 1200, height: 800, maximized: false };
    expect(resolveWindowPlacement(saved, [primary])).toEqual({
      bounds: { x: 100, y: 50, width: 1200, height: 800 },
      maximized: false,
    });
  });

  it('restores a maximized flag with the normal bounds', () => {
    const saved = { x: 100, y: 50, width: 1200, height: 800, maximized: true };
    expect(resolveWindowPlacement(saved, [primary])).toEqual({
      bounds: { x: 100, y: 50, width: 1200, height: 800 },
      maximized: true,
    });
  });

  it('falls back to the defaults when the saved monitor is gone', () => {
    const saved = { x: 2200, y: 100, width: 1200, height: 800, maximized: false };
    expect(resolveWindowPlacement(saved, [primary])).toEqual({
      bounds: { width: DEFAULT_WINDOW_SIZE.width, height: DEFAULT_WINDOW_SIZE.height },
      maximized: false,
    });
  });

  it('falls back to the defaults when only a sliver is visible', () => {
    const saved = { x: 1900, y: 100, width: 1200, height: 800, maximized: false };
    expect(resolveWindowPlacement(saved, [primary]).bounds).toEqual(DEFAULT_WINDOW_SIZE);
  });

  it('falls back to the defaults when there is no display', () => {
    const saved = { x: 0, y: 0, width: 1200, height: 800, maximized: false };
    expect(resolveWindowPlacement(saved, []).bounds).toEqual(DEFAULT_WINDOW_SIZE);
  });

  it('pulls a window that hangs over the edge back inside the work area', () => {
    const saved = { x: 1000, y: 600, width: 1200, height: 800, maximized: false };
    expect(resolveWindowPlacement(saved, [primary]).bounds).toEqual({
      x: 720,
      y: 240,
      width: 1200,
      height: 800,
    });
  });

  it('uses the display with the larger overlap', () => {
    const saved = { x: 3000, y: 100, width: 1100, height: 700, maximized: false };
    // 3000 + 1100 = 4100 exceeds the right display, which ends at 3200.
    expect(resolveWindowPlacement(saved, [primary, right]).bounds).toEqual({
      x: 2100,
      y: 100,
      width: 1100,
      height: 700,
    });
  });

  it('shrinks a window that is larger than the work area, never under the minimum', () => {
    const small = { x: 0, y: 0, width: 1024, height: 700 };
    const saved = { x: 0, y: 0, width: 1600, height: 900, maximized: false };
    expect(resolveWindowPlacement(saved, [small]).bounds).toEqual({
      x: 0,
      y: 0,
      width: 1024,
      height: 700,
    });
    const tiny = { x: 0, y: 0, width: 800, height: 600 };
    expect(resolveWindowPlacement(saved, [tiny]).bounds).toEqual({
      x: 0,
      y: 0,
      width: MIN_WINDOW_SIZE.width,
      height: MIN_WINDOW_SIZE.height,
    });
  });

  it('handles a display with a negative origin', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1040 };
    const saved = { x: -1800, y: 40, width: 1200, height: 800, maximized: false };
    expect(resolveWindowPlacement(saved, [primary, left]).bounds).toEqual({
      x: -1800,
      y: 40,
      width: 1200,
      height: 800,
    });
  });
});

describe('steadyWindowState', () => {
  const opened = { x: 30, y: 40, width: 1100, height: 720 };

  it('keeps the opened geometry when the window only differs by rounding', () => {
    const read = { x: 31, y: 40, width: 1102, height: 721, maximized: false };
    expect(steadyWindowState(read, opened)).toEqual({ ...opened, maximized: false });
  });

  it('is a fixed point: restoring and saving again never grows the window', () => {
    let saved = { ...opened, maximized: false };
    for (let launch = 0; launch < 5; launch += 1) {
      // Each launch the OS hands back a size two DIP bigger than the one it was given.
      const read = { ...saved, width: saved.width + 2, height: saved.height + 1 };
      saved = steadyWindowState(read, saved);
    }
    expect(saved.width).toBe(1100);
    expect(saved.height).toBe(720);
  });

  it('takes a real resize', () => {
    const read = {
      x: 30,
      y: 40,
      width: 1100 + WINDOW_ROUNDING_TOLERANCE + 1,
      height: 600,
      maximized: true,
    };
    expect(steadyWindowState(read, opened)).toEqual({
      x: 30,
      y: 40,
      width: 1100 + WINDOW_ROUNDING_TOLERANCE + 1,
      height: 600,
      maximized: true,
    });
  });

  it('takes every field as read when nothing was known', () => {
    const read = { x: 5, y: 6, width: 1000, height: 700, maximized: false };
    expect(steadyWindowState(read, null)).toEqual(read);
  });

  it('settles each field on its own', () => {
    const read = { x: 31, y: 90, width: 1101, height: 720, maximized: false };
    expect(steadyWindowState(read, opened)).toEqual({
      x: 30,
      y: 90,
      width: 1100,
      height: 720,
      maximized: false,
    });
  });
});
