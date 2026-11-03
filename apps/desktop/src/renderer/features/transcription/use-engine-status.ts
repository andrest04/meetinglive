import type { EngineStatusDto } from '@vozella/contracts';
import { useCallback, useEffect, useState } from 'react';

export interface EngineStatusState {
  /** Null until the first answer; stays null if the main process cannot answer. */
  readonly status: EngineStatusDto | null;
  readonly refresh: () => Promise<EngineStatusDto | null>;
}

/**
 * The engine status the main process keeps (spec 2.6): read once, then replaced whenever main
 * pushes a change (backend used, live drops, downloads, deletes). No polling.
 */
export function useEngineStatus(): EngineStatusState {
  const [status, setStatus] = useState<EngineStatusDto | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await window.vozella.invoke('transcription.getStatus', {});
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const flags = { alive: true, pushed: false };
    const off = window.vozella.on('transcription.statusChanged', (next) => {
      // A push that lands before the first answer wins: it is newer.
      flags.pushed = true;
      if (flags.alive) setStatus(next);
    });
    void (async () => {
      try {
        const first = await window.vozella.invoke('transcription.getStatus', {});
        if (flags.alive && !flags.pushed) setStatus(first);
      } catch {
        // The section keeps its loading state; a later push fills it.
      }
    })();
    return () => {
      flags.alive = false;
      off();
    };
  }, []);

  return { status, refresh };
}
