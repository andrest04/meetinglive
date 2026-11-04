import type { Rect } from '../meeting-detection/popup-placement';
import { isVertical, type DockEdge } from './pill-dock';
import { roundHalfEven } from './round';

export { roundHalfEven } from './round';

/** Spec live-copilot 2.3. DIP unless a name says otherwise. */
export const CAPSULE_SHORT_DIP = 64;
export const CAPSULE_VERTICAL_LONG_DIP = 240;
export const CAPSULE_HORIZONTAL_LONG_DIP = 272;
export const EDGE_MARGIN_DIP = 16;
export const PANEL_WIDTH_DIP = 380;
export const PANEL_HEIGHT_DIP = 500;
export const PANEL_GAP_DIP = 8;
export const EXPANDED_RADIUS_DIP = 28;
export const DRAG_THRESHOLD_DIP = 4;
export const PANEL_SLIDE_DIP = 16;
export const PULSE_SCALE = 1.08;

export const TIMINGS = {
  snapMs: 240,
  entranceMs: 300,
  exitMs: 160,
  panelMs: 220,
  pulseMs: 180,
  startedHintMs: 2500,
  saveDebounceMs: 500,
  tickMs: 16,
} as const;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const marginPx = (scale: number): number => roundHalfEven(EDGE_MARGIN_DIP * scale);
export const gapPx = (scale: number): number => roundHalfEven(PANEL_GAP_DIP * scale);

export function capsuleSizePx(edge: DockEdge, scale: number): Size {
  const shortPx = roundHalfEven(CAPSULE_SHORT_DIP * scale);
  const longDip = isVertical(edge) ? CAPSULE_VERTICAL_LONG_DIP : CAPSULE_HORIZONTAL_LONG_DIP;
  const longPx = roundHalfEven(longDip * scale);
  return isVertical(edge) ? { width: shortPx, height: longPx } : { width: longPx, height: shortPx };
}

export const panelSizePx = (scale: number): Size => ({
  width: roundHalfEven(PANEL_WIDTH_DIP * scale),
  height: roundHalfEven(PANEL_HEIGHT_DIP * scale),
});

/** Capsule host margin inside the window, in DIP: `(capsule - window) / scale`. */
export function capsuleHostMargin(
  capsule: Rect,
  window: Rect,
  scale: number,
): { readonly left: number; readonly top: number } {
  return { left: (capsule.x - window.x) / scale, top: (capsule.y - window.y) / scale };
}

/**
 * Panel position and size inside the window, in DIP. The gap is the unrounded
 * `8 * scale` (as in SetBounds); Left and Top offset the panel by capsule thickness plus gap.
 */
export function panelRect(edge: DockEdge, capsule: Rect, window: Rect, scale: number): Rect {
  const gap = PANEL_GAP_DIP * scale;
  let x = 0;
  let y = 0;
  let width: number;
  let height: number;
  if (isVertical(edge)) {
    x = edge === 'Left' ? capsule.width + gap : 0;
    width = window.width - capsule.width - gap;
    height = window.height;
  } else {
    y = edge === 'Top' ? capsule.height + gap : 0;
    width = window.width;
    height = window.height - capsule.height - gap;
  }
  return {
    x: x / scale,
    y: y / scale,
    width: Math.max(0, width / scale),
    height: Math.max(0, height / scale),
  };
}

/** Corner radius in DIP: half the short side when collapsed, 28 when expanded. */
export function shapeRadiusDip(
  widthPx: number,
  heightPx: number,
  scale: number,
  expanded: boolean,
): number {
  return expanded ? EXPANDED_RADIUS_DIP : Math.min(widthPx, heightPx) / scale / 2;
}

export const shapeRadiusPx = (
  widthPx: number,
  heightPx: number,
  scale: number,
  expanded: boolean,
): number => roundHalfEven(shapeRadiusDip(widthPx, heightPx, scale, expanded) * scale);

/** The docked rectangle pushed past its own edge by its thickness plus the margin. */
export function offscreenRect(edge: DockEdge, docked: Rect, margin: number): Rect {
  switch (edge) {
    case 'Right':
      return { ...docked, x: docked.x + docked.width + margin };
    case 'Left':
      return { ...docked, x: docked.x - docked.width - margin };
    case 'Top':
      return { ...docked, y: docked.y - docked.height - margin };
    case 'Bottom':
      return { ...docked, y: docked.y + docked.height + margin };
  }
}

/** Drag starts once the cursor moved `4 * scale` physical px (Euclidean) from the press point. */
export function dragStarted(dx: number, dy: number, scale: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_DIP * scale;
}
