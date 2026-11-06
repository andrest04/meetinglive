export function clampSize(size: number, min: number, max: number): number {
  return Math.min(Math.max(size, min), Math.max(min, max));
}

export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

/**
 * Which pane keeps the fixed size: the first one (left or top, the default) or the last one
 * (right or bottom). For the last one, moving the handle toward the start makes it bigger.
 */
export type FixedPane = 'start' | 'end';

/**
 * Keyboard model of the window splitter pattern. For side by side panes the arrows are
 * Left and Right, for stacked panes Up and Down. Home and End go to the limits of the fixed pane.
 * Returns null for keys that are not ours.
 */
export function sizeForKey(
  key: string,
  shift: boolean,
  size: number,
  limits: {
    min: number;
    max: number;
    orientation: 'horizontal' | 'vertical';
    fixedPane?: FixedPane;
  },
): number | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP;
  const forward = limits.orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const backward = limits.orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  const atEnd = limits.fixedPane === 'end';
  const grow = atEnd ? backward : forward;
  const shrink = atEnd ? forward : backward;
  switch (key) {
    case grow:
      return clampSize(size + step, limits.min, limits.max);
    case shrink:
      return clampSize(size - step, limits.min, limits.max);
    case 'Home':
      return limits.min;
    case 'End':
      return Math.max(limits.min, limits.max);
    default:
      return null;
  }
}

/**
 * Size of the fixed pane while dragging: the size at the start plus how far the pointer moved,
 * or minus it when the fixed pane is the last one.
 */
export function sizeForDrag(
  startSize: number,
  startPointer: number,
  pointer: number,
  limits: { min: number; max: number; fixedPane?: FixedPane },
): number {
  const moved = pointer - startPointer;
  const delta = limits.fixedPane === 'end' ? -moved : moved;
  return clampSize(startSize + delta, limits.min, limits.max);
}
