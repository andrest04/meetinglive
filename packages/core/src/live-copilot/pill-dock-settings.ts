import type { AppSettings } from '../library/settings';
import { DEFAULT_ALONG, parseEdge, type DockEdge } from './pill-dock';

export interface DockState {
  readonly edge: DockEdge;
  readonly along: number;
}

export const ALONG_SAVE_EPSILON = 0.0005;

/**
 * Edge and along from the settings (spec 4.1). The legacy `liveCopilotPillX` and
 * `liveCopilotPillY` are never read (bug 8, no migration); they stay in the file untouched
 * because `dockPatch` names only the two current fields.
 */
export function resolveDock(
  settings: Pick<AppSettings, 'liveCopilotPillEdge' | 'liveCopilotPillAlong'>,
): DockState {
  const raw = settings.liveCopilotPillAlong;
  const along =
    raw === null || !Number.isFinite(raw) ? DEFAULT_ALONG : Math.min(1, Math.max(0, raw));
  return { edge: parseEdge(settings.liveCopilotPillEdge), along };
}

/** False when the stored edge string is equal and the stored along is within 0.0005. */
export function shouldSaveDock(
  saved: Pick<AppSettings, 'liveCopilotPillEdge' | 'liveCopilotPillAlong'>,
  current: DockState,
): boolean {
  const sameEdge = saved.liveCopilotPillEdge === current.edge;
  const savedAlong = saved.liveCopilotPillAlong;
  const sameAlong =
    savedAlong !== null && Math.abs(savedAlong - current.along) <= ALONG_SAVE_EPSILON;
  return !(sameEdge && sameAlong);
}

export function dockPatch(
  state: DockState,
): Pick<AppSettings, 'liveCopilotPillEdge' | 'liveCopilotPillAlong'> {
  return { liveCopilotPillEdge: state.edge, liveCopilotPillAlong: state.along };
}
