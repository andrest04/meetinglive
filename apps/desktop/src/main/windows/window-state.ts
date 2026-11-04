import {
  resolveWindowPlacement,
  steadyWindowState,
  type WindowRect,
  type SavedWindowState,
  type WindowPlacement,
} from '@vozella/core';

/** How long after the last resize or move the geometry is written. */
export const WINDOW_STATE_SAVE_DEBOUNCE_MS = 500;

export interface WindowStateStore {
  load(): Promise<SavedWindowState | null>;
  save(state: SavedWindowState): Promise<void>;
}

export interface ScreenLike {
  getAllDisplays(): readonly { readonly workArea: WindowRect }[];
}

/** Where the main window opens, from the saved state and the displays that exist now. */
export async function loadWindowPlacement(
  store: Pick<WindowStateStore, 'load'>,
  screen: ScreenLike,
): Promise<WindowPlacement> {
  const saved = await store.load();
  return resolveWindowPlacement(
    saved,
    screen.getAllDisplays().map((display) => display.workArea),
  );
}

export type WindowStateEvent = 'resize' | 'move' | 'maximize' | 'unmaximize' | 'close';

/** The slice of BrowserWindow the tracker reads. */
export interface TrackedWindow {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  /** The restored bounds, also while the window is maximized or minimized. */
  getNormalBounds(): WindowRect;
  on(event: WindowStateEvent, listener: () => void): unknown;
}

export interface WindowStateTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Saves the window geometry: debounced while it is resized, moved or maximized, and at once when
 * it closes. Saving can never fail the window (the store swallows its errors).
 */
export function trackWindowState(
  window: TrackedWindow,
  store: Pick<WindowStateStore, 'save'>,
  /** The geometry the window was opened with, to tell a resize from display rounding. */
  opened: Partial<WindowRect> | null,
  timers: WindowStateTimers = globalThis,
  debounceMs = WINDOW_STATE_SAVE_DEBOUNCE_MS,
): void {
  let pending: unknown = null;
  let known = opened;

  const saveNow = (): void => {
    if (pending !== null) {
      timers.clearTimeout(pending);
      pending = null;
    }
    if (window.isDestroyed()) return;
    const { x, y, width, height } = window.getNormalBounds();
    const next = steadyWindowState({ x, y, width, height, maximized: window.isMaximized() }, known);
    known = next;
    void store.save(next);
  };
  const schedule = (): void => {
    if (pending !== null) timers.clearTimeout(pending);
    pending = timers.setTimeout(saveNow, debounceMs);
  };

  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) {
    window.on(event, schedule);
  }
  window.on('close', saveNow);
}
