import type { RetranscriptionResultDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngineStatus } from './use-engine-status';

type Availability = 'Available' | 'NoAudio' | 'Busy';

export interface RetranscriptionModel {
  /** A run for this meeting is going. */
  readonly running: boolean;
  /** "Transcribing audio... 42%" while it runs. */
  readonly status: string;
  readonly availability: Availability;
  /** The engine is installed. Unknown counts as ready: the run itself reports the real failure. */
  readonly engineReady: boolean;
  /** How the last run for this meeting ended, until dismissed or the next run starts. */
  readonly result: RetranscriptionResultDto | null;
  readonly start: () => void;
  readonly cancel: () => void;
  readonly dismissResult: () => void;
}

/**
 * One meeting's re-transcription as the page sees it. The main process owns the run (one at a
 * time, app wide); this hook follows its state and finish events and asks for availability again
 * whenever any run starts or ends, because that is what makes a meeting busy.
 */
export function useRetranscription(
  meetingId: string,
  onFinished?: (result: RetranscriptionResultDto) => void,
): RetranscriptionModel {
  const [state, setState] = useState({
    isRunning: false,
    meetingId: null as string | null,
    status: '',
  });
  const [availability, setAvailability] = useState<Availability>('Available');
  const [result, setResult] = useState<RetranscriptionResultDto | null>(null);
  const { status: engine } = useEngineStatus();
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const loadAvailability = useCallback(async () => {
    try {
      const answer = await window.vozella.invoke('retranscription.availability', { meetingId });
      setAvailability(answer.availability);
    } catch {
      // Keep the last answer; the run reports its own failure.
    }
  }, [meetingId]);

  useEffect(() => {
    const flags = { alive: true };
    setResult(null);
    void loadAvailability();
    void (async () => {
      try {
        const current = await window.vozella.invoke('retranscription.getState', {});
        if (flags.alive) setState(current);
      } catch {
        // No run is known.
      }
    })();
    const offState = window.vozella.on('retranscription.stateChanged', (next) => {
      if (!flags.alive) return;
      setState(next);
      void loadAvailability();
    });
    const offDone = window.vozella.on('retranscription.finished', (done) => {
      if (!flags.alive || done.meetingId !== meetingId) return;
      setResult(done);
      void loadAvailability();
      finishedRef.current?.(done);
    });
    return () => {
      flags.alive = false;
      offState();
      offDone();
    };
  }, [meetingId, loadAvailability]);

  const start = useCallback(() => {
    setResult(null);
    void window.vozella
      .invoke('retranscription.start', { meetingId })
      .then(() => loadAvailability())
      .catch(() => loadAvailability());
  }, [meetingId, loadAvailability]);

  const cancel = useCallback(() => {
    void window.vozella.invoke('retranscription.cancel', {}).catch(() => undefined);
  }, []);

  const mine = state.isRunning && state.meetingId === meetingId;
  return {
    running: mine,
    status: mine ? state.status : '',
    availability,
    engineReady: engine?.ready ?? true,
    result,
    start,
    cancel,
    dismissResult: () => {
      setResult(null);
    },
  };
}
