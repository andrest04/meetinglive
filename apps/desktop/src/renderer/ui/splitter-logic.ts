export function clampSize(size: number, min: number, max: number): number {
  return Math.min(Math.max(size, min), Math.max(min, max));
}

export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

/**
 * Keyboard model of the window splitter pattern. For side by side panes the arrows are
 * Left and Right, for stacked panes Up and Down. Home and End go to the limits.
 * Returns null for keys that are not ours.
 */
export function sizeForKey(
  key: string,
  shift: boolean,
  size: number,
  limits: { min: number; max: number; orientation: 'horizontal' | 'vertical' },
): number | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP;
  const grow = limits.orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const shrink = limits.orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
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

/** Size of the first pane while dragging: the size at the start plus how far the pointer moved. */
export function sizeForDrag(
  startSize: number,
  startPointer: number,
  pointer: number,
  limits: { min: number; max: number },
): number {
  return clampSize(startSize + (pointer - startPointer), limits.min, limits.max);
}
