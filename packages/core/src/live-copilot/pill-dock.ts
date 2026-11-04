import { PILL_EDGES, type PillEdge } from '../library/settings';
import { clamp, type Point, type Rect } from '../meeting-detection/popup-placement';
import { roundHalfEven } from './round';

/** Pure docking math (spec live-copilot 2.4). Integer pixel math; callers choose the unit. */
export type DockEdge = PillEdge;

export const DEFAULT_EDGE: DockEdge = 'Right';
export const DEFAULT_ALONG = 0.5;

export const isVertical = (edge: DockEdge): boolean => edge === 'Left' || edge === 'Right';

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Closest edge to a point. Strict less-than at each step, so ties prefer
 * Right, then Left, then Bottom, then Top.
 */
export function nearestEdge(centerX: number, centerY: number, area: Rect): DockEdge {
  let edge: DockEdge = 'Right';
  let best = area.x + area.width - centerX;
  const left = centerX - area.x;
  const bottom = area.y + area.height - centerY;
  const top = centerY - area.y;
  if (left < best) {
    edge = 'Left';
    best = left;
  }
  if (bottom < best) {
    edge = 'Bottom';
    best = bottom;
  }
  if (top < best) edge = 'Top';
  return edge;
}

export const travelRange = (areaLength: number, capsuleLength: number, margin: number): number =>
  Math.max(0, areaLength - capsuleLength - 2 * margin);

/** Capsule position for an edge and a fractional offset along it. Rounds half to even (item 40). */
export function positionFor(
  edge: DockEdge,
  along: number,
  width: number,
  height: number,
  area: Rect,
  margin: number,
): Point {
  const t = Number.isFinite(along) ? clampNumber(along, 0, 1) : DEFAULT_ALONG;
  if (isVertical(edge)) {
    return {
      x: edge === 'Left' ? area.x + margin : area.x + area.width - width - margin,
      y: area.y + margin + roundHalfEven(t * travelRange(area.height, height, margin)),
    };
  }
  return {
    x: area.x + margin + roundHalfEven(t * travelRange(area.width, width, margin)),
    y: edge === 'Top' ? area.y + margin : area.y + area.height - height - margin,
  };
}

/** Inverse of `positionFor`; 0.5 when the edge has no travel. */
export function alongFor(
  edge: DockEdge,
  x: number,
  y: number,
  width: number,
  height: number,
  area: Rect,
  margin: number,
): number {
  const vertical = isVertical(edge);
  const offset = vertical ? y - area.y - margin : x - area.x - margin;
  const range = vertical
    ? travelRange(area.height, height, margin)
    : travelRange(area.width, width, margin);
  return range <= 0 ? DEFAULT_ALONG : clampNumber(offset / range, 0, 1);
}

/**
 * Window rectangle with the chat panel open. The panel grows from the capsule toward the
 * screen center; centering uses truncating division (C# int `/ 2`), then the result is
 * clamped into the work area.
 */
export function expandedBounds(
  edge: DockEdge,
  capsule: Rect,
  panelWidth: number,
  panelHeight: number,
  gap: number,
  area: Rect,
): Rect {
  let x: number;
  let y: number;
  let width: number;
  let height: number;
  if (isVertical(edge)) {
    width = Math.min(capsule.width + gap + panelWidth, area.width);
    height = Math.min(Math.max(capsule.height, panelHeight), area.height);
    x = edge === 'Left' ? capsule.x : capsule.x + capsule.width - width;
    y = capsule.y + Math.trunc((capsule.height - height) / 2);
  } else {
    width = Math.min(Math.max(capsule.width, panelWidth), area.width);
    height = Math.min(capsule.height + gap + panelHeight, area.height);
    x = capsule.x + Math.trunc((capsule.width - width) / 2);
    y = edge === 'Top' ? capsule.y : capsule.y + capsule.height - height;
  }
  const clamped = clamp(x, y, width, height, area);
  return { x: clamped.x, y: clamped.y, width, height };
}

/**
 * Item 46 and bug 5: only the four names, case-insensitive. Numeric strings and comma
 * flags ("0", "Left,Top") fall back to Right; the C# enum parser accepted them.
 */
export function parseEdge(raw: string | null | undefined): DockEdge {
  if (typeof raw !== 'string') return DEFAULT_EDGE;
  const lowered = raw.toLowerCase();
  return PILL_EDGES.find((edge) => edge.toLowerCase() === lowered) ?? DEFAULT_EDGE;
}
