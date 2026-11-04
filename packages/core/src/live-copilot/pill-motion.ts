import type { Rect } from '../meeting-detection/popup-placement';
import { alongFor, isVertical, nearestEdge, positionFor, type DockEdge } from './pill-dock';
import { capsuleSizePx, marginPx, TIMINGS } from './pill-layout';
import { roundHalfEven } from './round';

export const easeOutQuint = (t: number): number => 1 - (1 - t) ** 5;
export const easeInCubic = (t: number): number => t * t * t;
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** `clamp(elapsed / duration, 0, 1)`; a zero duration is done. */
export function tweenProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(Math.max(elapsedMs / durationMs, 0), 1);
}

/** Linear interpolation per component, each rounded half to even like the C# tween. */
export function lerpRect(from: Rect, to: Rect, t: number): Rect {
  const lerp = (a: number, b: number): number => roundHalfEven(a + (b - a) * t);
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    width: lerp(from.width, to.width),
    height: lerp(from.height, to.height),
  };
}

export interface SnapInput {
  readonly fromEdge: DockEdge;
  /** The window rectangle where the drag ended, in physical px. */
  readonly window: Rect;
  /** Work area of the display nearest the dropped window. */
  readonly area: Rect;
  readonly scale: number;
}

export interface SnapPlan {
  readonly edge: DockEdge;
  readonly along: number;
  /** Collapsed target rectangle. */
  readonly target: Rect;
  /** True when the orientation changes (left/right to top/bottom or back). */
  readonly flip: boolean;
}

/** Spec 2.7 `SnapToNearestEdge`: center by integer division, new orientation size, along from the center. */
export function planSnap({ fromEdge, window, area, scale }: SnapInput): SnapPlan {
  const centerX = window.x + Math.trunc(window.width / 2);
  const centerY = window.y + Math.trunc(window.height / 2);
  const edge = nearestEdge(centerX, centerY, area);
  const size = capsuleSizePx(edge, scale);
  const margin = marginPx(scale);
  const along = alongFor(
    edge,
    centerX - Math.trunc(size.width / 2),
    centerY - Math.trunc(size.height / 2),
    size.width,
    size.height,
    area,
    margin,
  );
  const origin = positionFor(edge, along, size.width, size.height, area, margin);
  return {
    edge,
    along,
    target: { x: origin.x, y: origin.y, width: size.width, height: size.height },
    flip: isVertical(fromEdge) !== isVertical(edge),
  };
}

export interface SnapFrame {
  readonly eased: number;
  readonly rect: Rect;
  /** True once the layout orientation must switch (flip and eased >= 0.5). */
  readonly switchOrientation: boolean;
  /** Capsule host opacity: `|2 * eased - 1|` while flipping, else 1. */
  readonly opacity: number;
}

export function snapFrame(
  plan: SnapPlan,
  from: Rect,
  elapsedMs: number,
  durationMs: number = TIMINGS.snapMs,
): SnapFrame {
  const t = tweenProgress(elapsedMs, durationMs);
  const eased = plan.flip ? easeInOutCubic(t) : easeOutCubic(t);
  return {
    eased,
    rect: lerpRect(from, plan.target, eased),
    switchOrientation: plan.flip && eased >= 0.5,
    opacity: plan.flip ? Math.abs(2 * eased - 1) : 1,
  };
}

export const REDOCK_TOLERANCE_PX = 2;

/** Re-dock when the OS moved or resized the window by more than the tolerance on any component. */
export function shouldRedock(
  expected: Rect,
  actual: Rect,
  tolerance: number = REDOCK_TOLERANCE_PX,
): boolean {
  return (
    Math.abs(actual.x - expected.x) > tolerance ||
    Math.abs(actual.y - expected.y) > tolerance ||
    Math.abs(actual.width - expected.width) > tolerance ||
    Math.abs(actual.height - expected.height) > tolerance
  );
}
