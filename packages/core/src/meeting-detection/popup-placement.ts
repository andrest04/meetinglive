/** Popup geometry, in device independent pixels unless a name says otherwise. */
export const POPUP_WIDTH_DIP = 480;
export const POPUP_HEIGHT_DIP = 72;
export const POPUP_MARGIN_DIP = 24;
export const POPUP_SLIDE_DIP = 24;
export const POPUP_AUTO_HIDE_MS = 30_000;
export const POPUP_ENTRANCE_MS = 280;
export const POPUP_EXIT_MS = 150;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keeps a width x height box inside the area; when it does not fit, it pins to the area origin. */
export function clamp(x: number, y: number, width: number, height: number, area: Rect): Point {
  const maxX = Math.max(area.x, area.x + area.width - width);
  const maxY = Math.max(area.y, area.y + area.height - height);
  return { x: clampInt(x, area.x, maxX), y: clampInt(y, area.y, maxY) };
}

/** Top-right corner of the area, inset by margin, then clamped inside it. */
export function topRight(width: number, height: number, area: Rect, margin: number): Point {
  return clamp(area.x + area.width - width - margin, area.y + margin, width, height, area);
}

/** Popup bounds for an area and a scale factor (DPI / 96). */
export function popupBounds(area: Rect, scale: number): Rect {
  const width = Math.ceil(POPUP_WIDTH_DIP * scale);
  const height = Math.ceil(POPUP_HEIGHT_DIP * scale);
  const margin = Math.floor(POPUP_MARGIN_DIP * scale);
  const { x, y } = topRight(width, height, area, margin);
  return { x, y, width, height };
}
