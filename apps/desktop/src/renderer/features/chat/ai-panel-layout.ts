import { clampSize } from '../../ui/splitter-logic';

/** Width limits of the AI panel, and the width a double click on its handle restores. */
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 520;
export const PANEL_DEFAULT_WIDTH = 380;

/** The page keeps at least this much beside a docked panel; below it the panel floats over it. */
export const DOCK_MIN_CONTENT_WIDTH = 560;

export const PANEL_OPEN_KEY = 'vozella.aiPanel.open';
export const PANEL_WIDTH_KEY = 'vozella.aiPanel.width';

export type PanelMode = 'dock' | 'overlay';

/**
 * Whether the panel docks beside the page or floats over it. `available` is the width the page
 * and the panel share (the window minus the sidebar); null before the first measurement.
 */
export function panelMode(available: number | null, panelWidth: number): PanelMode {
  if (available === null) return 'dock';
  return available - panelWidth < DOCK_MIN_CONTENT_WIDTH ? 'overlay' : 'dock';
}

export function parseStoredWidth(stored: string | null): number {
  const value = stored === null ? Number.NaN : Number.parseInt(stored, 10);
  if (!Number.isFinite(value)) return PANEL_DEFAULT_WIDTH;
  return clampSize(value, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
}

export const parseStoredOpen = (stored: string | null): boolean => stored === 'true';

export interface ToggleKeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** Ctrl+J opens or closes the panel anywhere in the window; Ctrl+Shift+J is an alias. */
export const PANEL_TOGGLE_KEYS: readonly string[] = ['Ctrl', 'J'];

export function isPanelToggle(event: ToggleKeyLike): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'j';
}
