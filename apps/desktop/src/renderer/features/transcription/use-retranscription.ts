import type { RetranscriptionResultDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEngineStatus } from './use-engine-status';

export type Availability = 'Available' | 'NoAudio' | 'Busy';

export interface RetranscriptionOptions {
  /** Called after a run for this meeting has ended, so the page can reload its tabs. */
  readonly onFinished?: (result: RetranscriptionResultDto) => void;
  /** Called when a fresh check finds no audio, so the page can refresh what it knows (item 100). */
  readonly onAudioChanged?: () => void;
}

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
  /** Asks again whether this meeting can be re-transcribed now (items 96 and 100). */
  readonly recheck: () => Promise<boolean>;
  /** Re-checks, then starts. Nothing starts when the meeting is no longer available. */
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
  options: RetranscriptionOptions = {},
): RetranscriptionModel {
  const [state, setState] = useState({
    isRunning: false,
    meetingId: null as string | null,
    status: '',
  });
  const [availability, setAvailability] = useState<Availability>('Available');
  const [result, setResult] = useState<RetranscriptionResultDto | null>(null);
  const { status: engine } = useEngineStatus();
  const finishedRef = useRef(options.onFinished);
  finishedRef.current = options.onFinished;
  const audioRef = useRef(options.onAudioChanged);
  audioRef.current = options.onAudioChanged;

  const loadAvailability = useCallback(async (): Promise<Availability | null> => {
    try {
      const answer = await window.vozella.invoke('retranscription.availability', { meetingId });
      setAvailability(answer.availability);
      return answer.availability;
    } catch {
      // Keep the last answer; the run reports its own failure.
      return null;
    }
  }, [meetingId]);

  const dismissKept = useCallback(() => {
    void window.vozella.invoke('retranscription.dismiss', { meetingId }).catch(() => undefined);
  }, [meetingId]);

  useEffect(() => {
    const flags = { alive: true };
    setResult(null);
    if (meetingId === '') return undefined;
    void loadAvailability();
    void (async () => {
      try {
        const current = await window.vozella.invoke('retranscription.getState', {});
        if (!flags.alive) return;
        setState(current);
        // A run that ended while the page was elsewhere left its result behind (B7): show it once.
        const kept = current.lastResults.find((entry) => entry.meetingId === meetingId);
        if (kept) {
          setResult(kept);
          dismissKept();
        }
      } catch {
        // No run is known.
      }
    })();
    const offState = window.vozella.on('retranscription.stateChanged', (next) => {
      if (!flags.alive) return;
      setState(next);
      void loadAvailability();
    });
    // A take or a summary run makes this meeting busy in main; when either ends, ask again (B16).
    const offRecording = window.vozella.on('recording.state', () => {
      if (flags.alive) void loadAvailability();
    });
    const offSummary = window.vozella.on('summaries.progress', (progress) => {
      if (flags.alive && progress.meetingId === meetingId) void loadAvailability();
    });
    const offDone = window.vozella.on('retranscription.finished', (done) => {
      if (!flags.alive || done.meetingId !== meetingId) return;
      setResult(done);
      // The reader has it on screen now; main need not keep it for a later visit.
      dismissKept();
      void loadAvailability();
      finishedRef.current?.(done);
    });
    return () => {
      flags.alive = false;
      offState();
      offRecording();
      offSummary();
      offDone();
    };
  }, [meetingId, loadAvailability, dismissKept]);

  const recheck = useCallback(async () => {
    const now = await loadAvailability();
    if (now === 'NoAudio') audioRef.current?.();
    return now === 'Available';
  }, [loadAvailability]);

  const start = useCallback(() => {
    void (async () => {
      // The file may have gone since the page drew the button: ask again before anything starts.
      if (!(await recheck())) return;
      setResult(null);
      try {
        await window.vozella.invoke('retranscription.start', { meetingId });
      } catch {
        // The runner reports its own failure through the finish event.
      }
      await loadAvailability();
    })();
  }, [meetingId, loadAvailability, recheck]);

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
    recheck,
    start,
    cancel,
    dismissResult: () => {
      setResult(null);
      dismissKept();
    },
  };
}
