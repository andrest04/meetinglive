import { useCallback, useEffect, useRef, useState } from 'react';

export type TranscriptPhase = 'loading' | 'error' | 'ready';

export interface TranscriptModel {
  readonly phase: TranscriptPhase;
  /** The raw stored transcript ('' when there is none). */
  readonly text: string;
  readonly retry: () => void;
}

/**
 * Loads the transcript of the open meeting. The first state is loading, so the empty message
 * never flashes (B8). A save of this meeting (mid re-transcription) reloads quietly (B10); a
 * result for an older request, or for another meeting, is dropped. The shell owns selection.
 */
export function useTranscript(meetingId: string): TranscriptModel {
  const [phase, setPhase] = useState<TranscriptPhase>('loading');
  const [text, setText] = useState('');
  const sequence = useRef(0);
  const shown = useRef('');
  const loaded = useRef(false);

  const load = useCallback(
    async (quiet: boolean): Promise<void> => {
      const mine = (sequence.current += 1);
      if (!quiet) setPhase('loading');
      try {
        const view = await window.vozella.invoke('session.getView', { id: meetingId });
        if (mine !== sequence.current) return;
        const next = view.record?.transcript ?? '';
        shown.current = next;
        loaded.current = true;
        setText(next);
        setPhase('ready');
      } catch {
        if (mine !== sequence.current) return;
        // A failed quiet refresh keeps what is on screen, unless it replaced the first load (B9).
        if (!quiet || !loaded.current) setPhase('error');
      }
    },
    [meetingId],
  );

  useEffect(() => {
    shown.current = '';
    loaded.current = false;
    setText('');
    void load(false);
    const off = window.vozella.on('workspace.meetingChanged', ({ id }) => {
      if (id === meetingId) void load(true);
    });
    return () => {
      off();
      sequence.current += 1;
    };
  }, [load, meetingId]);

  const retry = useCallback(() => {
    void load(false);
  }, [load]);

  return { phase, text, retry };
}
