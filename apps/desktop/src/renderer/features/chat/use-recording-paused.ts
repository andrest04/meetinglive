import { useEffect, useState } from 'react';

/**
 * Whether the take is paused, from main's `recording.state`. The AI panel follows it on every
 * page, so it does not lean on the Record page's store, which only listens while that page is open.
 */
export function useRecordingPaused(): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    const off = window.vozella.on('recording.state', (next) => {
      setPaused(next.isPaused);
    });
    window.vozella
      .invoke('recording.getState', {})
      .then((state) => {
        if (alive) setPaused(state.isPaused);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return paused;
}
