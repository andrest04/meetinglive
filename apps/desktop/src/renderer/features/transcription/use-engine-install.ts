import type { InstallOutcomeDto, InstallProgressDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

export type InstallPhase = 'idle' | 'running' | 'failed';

export interface EngineInstall {
  readonly phase: InstallPhase;
  readonly progress: InstallProgressDto | null;
  /** The raw failure message (spec 2.2), while `phase` is `failed`. */
  readonly error: string | null;
  /** Downloads whatever is missing. Main shares one transfer between callers. */
  readonly start: () => Promise<InstallOutcomeDto>;
  readonly cancel: () => Promise<void>;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * One engine download as the setup dialog and the Settings button show it. The main process owns
 * the transfer and shares it between callers, so a second window or a second click joins the first
 * (spec 2.2, 2.6); this hook only follows the progress events and keeps the failure text.
 */
export function useEngineInstall(): EngineInstall {
  const [phase, setPhase] = useState<InstallPhase>('idle');
  const [progress, setProgress] = useState<InstallProgressDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // Only the latest call moves the state: an older one may still be winding down after a cancel.
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;
    const off = window.vozella.on('transcription.installProgress', (next) => {
      if (alive.current) setProgress(next);
    });
    return () => {
      alive.current = false;
      off();
    };
  }, []);

  const start = useCallback(async (): Promise<InstallOutcomeDto> => {
    generation.current += 1;
    const mine = generation.current;
    setPhase('running');
    setProgress(null);
    setError(null);
    let outcome: InstallOutcomeDto;
    try {
      outcome = await window.vozella.invoke('transcription.ensureEngine', {});
    } catch (caught) {
      outcome = { status: 'failed', message: errorText(caught) };
    }
    if (alive.current && mine === generation.current) {
      setProgress(null);
      if (outcome.status === 'failed') {
        setPhase('failed');
        setError(outcome.message);
      } else {
        setPhase('idle');
      }
    }
    return outcome;
  }, []);

  const cancel = useCallback(async () => {
    try {
      await window.vozella.invoke('transcription.cancelInstall', {});
    } catch {
      // Nothing was running, or main is gone; the dialog closes either way.
    }
  }, []);

  return { phase, progress, error, start, cancel };
}
