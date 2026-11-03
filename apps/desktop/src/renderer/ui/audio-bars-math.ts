/** The numbers of the five-bar level indicator (spec 3.5). Pure math, no DOM. */

export const BAR_COUNT = 5;
export const BAR_WIDTH = 3;
export const BAR_GAP = 3;
export const BAR_REST_HEIGHT = 3;
export const BAR_MAX_HEIGHT = 24;
export const BAR_TICK_MS = 33;
export const ATTACK = 0.55;
export const DECAY = 0.14;

export const BAR_PROFILE: readonly number[] = [0.55, 0.8, 1.0, 0.8, 0.55];
export const PHASE_STEP: readonly number[] = [0, 1.3, 2.6, 3.9, 5.2];
export const PHASE_SPEED: readonly number[] = [7, 9.5, 8, 10.5, 7.5];

const at = (list: readonly number[], index: number): number => list[index] ?? 0;

/** 0..1 from a 0..100 level; paused or non-finite is flat. */
export function levelFraction(level: number, paused: boolean): number {
  if (paused || !Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level / 100));
}

/** The wobble factor of one bar `seconds` after the animation started. */
export function barPhase(index: number, seconds: number): number {
  return 0.75 + 0.25 * Math.sin(at(PHASE_STEP, index) + seconds * at(PHASE_SPEED, index));
}

/** Where bar `index` wants to be: rest height plus 21 px scaled by level, profile and phase. */
export function barTarget(index: number, level: number, paused: boolean, phase: number): number {
  const fraction = levelFraction(level, paused);
  const scaled = Math.min(1, Math.max(0, fraction * at(BAR_PROFILE, index) * phase));
  return BAR_REST_HEIGHT + (BAR_MAX_HEIGHT - BAR_REST_HEIGHT) * scaled;
}

/** One timer tick: ease toward the target, quicker up than down, rounded to 0.1. */
export function easeBar(height: number, target: number): number {
  const next = height + (target - height) * (target > height ? ATTACK : DECAY);
  return Math.round(next * 10) / 10;
}

/** All five heights when nothing animates: the target at phase 1. */
export function snapHeights(level: number, paused: boolean): number[] {
  return Array.from({ length: BAR_COUNT }, (_, i) => barTarget(i, level, paused, 1));
}

/** All five heights one tick later while the timer runs. */
export function tickHeights(
  heights: readonly number[],
  level: number,
  paused: boolean,
  seconds: number,
): number[] {
  return heights.map((height, i) =>
    easeBar(height, barTarget(i, level, paused, barPhase(i, seconds))),
  );
}
