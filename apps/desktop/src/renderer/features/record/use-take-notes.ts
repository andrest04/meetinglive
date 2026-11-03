import { useEffect, useRef } from 'react';

/**
 * A blank take-notes request (calendar-detection items 93, 94 and 96). Main remembers the request
 * until this page consumes it: on mount (the user navigated here), on the live event while the
 * window is visible, and when the window becomes visible again. Starting is skipped while a take
 * is running or being processed, and a request that carries an event id is ignored.
 */
export function useTakeNotesRequest(idle: boolean, start: () => void): void {
  const latest = useRef({ idle, start });
  latest.current = { idle, start };

  useEffect(() => {
    let alive = true;
    const isIdle = (): boolean => alive && latest.current.idle;
    const consume = async (): Promise<void> => {
      try {
        const result = await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'consumeTakeNotes' },
        });
        const request = result.takeNotes;
        if (request?.pending !== true || request.calendarEventId !== null || !isIdle()) return;
        // A take that kept running in main while another page was open is not idle for main.
        const state = await window.vozella.invoke('recording.getState', {});
        if (state.phase !== 'Idle') return;
      } catch {
        return;
      }
      if (isIdle()) latest.current.start();
    };
    void consume();
    const visible = (): boolean => document.visibilityState === 'visible';
    const off = window.vozella.on('workspace.takeNotesRequested', () => {
      if (visible()) void consume();
    });
    const onVisibility = (): void => {
      if (visible()) void consume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      off();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
