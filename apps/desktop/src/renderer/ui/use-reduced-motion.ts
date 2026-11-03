import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

const read = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;

/** True while the OS asks for less motion; follows changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(QUERY);
    const onChange = (): void => {
      setReduced(list.matches);
    };
    onChange();
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, []);
  return reduced;
}
