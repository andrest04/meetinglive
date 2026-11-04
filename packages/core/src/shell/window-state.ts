/** Default and minimum size of the main window, in device independent pixels (items 16, 17). */
export const DEFAULT_WINDOW_SIZE = { width: 1180, height: 760 } as const;
export const MIN_WINDOW_SIZE = { width: 960, height: 680 } as const;

/** Least part of a saved window that must lie on a display for the position to be trusted. */
const MIN_VISIBLE = { width: 100, height: 60 } as const;

export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What `window-state.json` holds: the normal (restored) bounds and whether it was maximized. */
export interface SavedWindowState extends WindowRect {
  readonly maximized: boolean;
}

export interface WindowPlacement {
  /** Position is left out when the OS should choose it. */
  readonly bounds: {
    readonly x?: number;
    readonly y?: number;
    readonly width: number;
    readonly height: number;
  };
  readonly maximized: boolean;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Reads whatever the file held. Anything that is not four finite numbers, or a size under the
 * minimum, is rejected as a whole: a half-trusted rectangle is worse than the defaults.
 */
export function sanitizeWindowState(raw: unknown): SavedWindowState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const x = whole(record.x);
  const y = whole(record.y);
  const width = whole(record.width);
  const height = whole(record.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < MIN_WINDOW_SIZE.width || height < MIN_WINDOW_SIZE.height) return null;
  return { x, y, width, height, maximized: record.maximized === true };
}

function overlap(a: WindowRect, b: WindowRect): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Chooses where the window opens. The saved bounds are used on the display they overlap most,
 * pulled inside its work area; with no usable state, or no display showing enough of it (a monitor
 * was unplugged), the defaults apply and the OS places the window.
 */
export function resolveWindowPlacement(
  saved: unknown,
  workAreas: readonly WindowRect[],
): WindowPlacement {
  const fallback: WindowPlacement = {
    bounds: { width: DEFAULT_WINDOW_SIZE.width, height: DEFAULT_WINDOW_SIZE.height },
    maximized: false,
  };
  const state = sanitizeWindowState(saved);
  if (state === null) return fallback;

  let best: WindowRect | null = null;
  let bestArea = 0;
  for (const area of workAreas) {
    const seen = overlap(state, area);
    if (seen.width < MIN_VISIBLE.width || seen.height < MIN_VISIBLE.height) continue;
    if (seen.width * seen.height > bestArea) {
      best = area;
      bestArea = seen.width * seen.height;
    }
  }
  if (best === null) return fallback;

  const width = Math.max(Math.min(state.width, best.width), MIN_WINDOW_SIZE.width);
  const height = Math.max(Math.min(state.height, best.height), MIN_WINDOW_SIZE.height);
  return {
    bounds: {
      x: clamp(state.x, best.x, best.x + best.width - width),
      y: clamp(state.y, best.y, best.y + best.height - height),
      width,
      height,
    },
    maximized: state.maximized,
  };
}

/**
 * Largest difference, in DIP, that is rounding rather than a user resize. At a fractional display
 * scale a size set in DIP comes back a pixel or two different (1100 became 1102, a frame can add
 * a few more); saving that back would make the window grow a little on every launch.
 */
export const WINDOW_ROUNDING_TOLERANCE = 4;

/**
 * Keeps the geometry the window was opened with when it only moved by rounding noise, field by
 * field, so restoring and saving again is stable (a fixed point instead of a ratchet).
 */
export function steadyWindowState(
  current: SavedWindowState,
  previous: Partial<WindowRect> | null,
): SavedWindowState {
  const settle = (now: number, before: number | undefined): number =>
    before !== undefined && Math.abs(now - before) <= WINDOW_ROUNDING_TOLERANCE ? before : now;
  return {
    x: settle(current.x, previous?.x),
    y: settle(current.y, previous?.y),
    width: settle(current.width, previous?.width),
    height: settle(current.height, previous?.height),
    maximized: current.maximized,
  };
}
