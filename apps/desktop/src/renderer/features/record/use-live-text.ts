import { useEffect, useState, type RefObject } from 'react';

/**
 * Holds `value` back while `held` is true and shows the newest again the moment it turns false
 * (spec 2.7, item 106): a reader selecting text must not have it replaced under the cursor, and
 * the display catches up on blur. While not held the value passes straight through.
 */
export function useHeldValue<T>(value: T, held: boolean): T {
  const [shown, setShown] = useState(value);
  if (!held && !Object.is(shown, value)) setShown(value);
  return held ? shown : value;
}

export interface ReadingHold {
  readonly held: boolean;
  readonly onFocus: () => void;
  readonly onBlur: (event: { relatedTarget: EventTarget | null }) => void;
}

/**
 * True while the keyboard focus is inside `ref` or a non-empty selection lies inside it. The
 * selection is read from `selectionchange`, so a drag with the mouse holds the display at once.
 */
export function useReadingHold(ref: RefObject<HTMLElement | null>): ReadingHold {
  const [focused, setFocused] = useState(false);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    const onChange = (): void => {
      const selection = window.getSelection();
      const root = ref.current;
      const inside =
        !!selection &&
        !!root &&
        !selection.isCollapsed &&
        !!selection.anchorNode &&
        root.contains(selection.anchorNode);
      setSelecting((current) => (current === inside ? current : inside));
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
    };
  }, [ref]);

  return {
    held: focused || selecting,
    onFocus: () => {
      setFocused(true);
    },
    onBlur: (event) => {
      const root = ref.current;
      const next = event.relatedTarget;
      if (root && next instanceof Node && root.contains(next)) return;
      setFocused(false);
    },
  };
}
