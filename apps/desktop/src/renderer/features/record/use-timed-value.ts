import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A value that clears itself `ms` after it was last set. Setting it again restarts the single
 * timer (items 68 and 70), and the timer dies with the component.
 */
export function useTimedValue<T>(ms: number): {
  readonly value: T | null;
  readonly show: (next: T) => void;
  readonly clear: () => void;
} {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setValue(null);
  }, []);

  const show = useCallback(
    (next: T) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      setValue(next);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setValue(null);
      }, ms);
    },
    [ms],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return { value, show, clear };
}
