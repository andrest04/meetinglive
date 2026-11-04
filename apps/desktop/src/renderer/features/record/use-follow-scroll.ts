import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Spec 2.7: the view counts as at the end within this many pixels. */
export const STICK_THRESHOLD = 32;

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Stuck when the content does not scroll, or the offset is within 32 px of the end (item 107). */
export function isStuck({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): boolean {
  const scrollable = scrollHeight - clientHeight;
  return scrollable <= 0 || scrollTop >= scrollable - STICK_THRESHOLD;
}

export interface FollowScroll {
  /** False once the reader scrolled up: the Jump to latest button shows only then. */
  readonly stuck: boolean;
  readonly onScroll: () => void;
  /** Sticks again and scrolls to the end without animation. */
  readonly jumpToLatest: () => void;
}

/**
 * Keeps a scroll area at its end while the reader has not moved away from it. `version` is any
 * value that changes when the content does. The scroll never animates: a calm canvas does not
 * glide, and a smooth scroll that lags new text would drop the reader off the end.
 */
export function useFollowScroll(
  ref: RefObject<HTMLElement | null>,
  version: unknown,
): FollowScroll {
  const [stuck, setStuck] = useState(true);
  const stuckRef = useRef(true);

  const update = useCallback((next: boolean) => {
    stuckRef.current = next;
    setStuck((current) => (current === next ? current : next));
  }, []);

  const toEnd = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ref]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (el) update(isStuck(el));
  }, [ref, update]);

  // After the new text is laid out and before it is painted, so the end never flashes.
  useLayoutEffect(() => {
    if (stuckRef.current) toEnd();
  }, [version, toEnd]);

  const jumpToLatest = useCallback(() => {
    update(true);
    toEnd();
  }, [toEnd, update]);

  return { stuck, onScroll, jumpToLatest };
}
