import type { MicrophoneChoiceDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { noticeMessage, startFailureMessage, type Message } from '../audio/recording-status';

export type TakePhase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'importing';

export interface TakeNotice {
  readonly tone: 'info' | 'warning';
  readonly message: Message;
}

export interface Take {
  readonly phase: TakePhase;
  /** The last outcome or failure to show while no recording is running. */
  readonly notice: TakeNotice | null;
  readonly start: (title: string, microphone: MicrophoneChoiceDto) => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly resume: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly importAudio: (title: string) => Promise<void>;
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const saved = (path: string): TakeNotice => ({
  tone: 'info',
  message: { key: 'Ui_TakeSaved', args: [baseName(path)] },
});
const warning = (key: Message['key'], text: string): TakeNotice => ({
  tone: 'warning',
  message: { key, args: [text] },
});

/**
 * The Record page's take: Record, Pause, Resume, Stop and Import audio (the capture half of the
 * recording module's spec 2.2 and 2.12). Main owns the file and the clock; this hook holds the
 * phase the buttons depend on and the one message to show. A command is ignored while another
 * one is still running.
 */
export function useTake(): Take {
  const [phase, setPhase] = useState<TakePhase>('idle');
  const [notice, setNotice] = useState<TakeNotice | null>(null);
  const current = useRef<TakePhase>('idle');
  // A fatal notice that arrives while the start call is still in flight (spec item 37).
  const early = useRef<Message | null>(null);

  const takeEarly = (): Message | null => {
    const failure = early.current;
    early.current = null;
    return failure;
  };

  const move = useCallback((next: TakePhase) => {
    current.current = next;
    setPhase(next);
  }, []);

  const pause = useCallback(async () => {
    if (current.current !== 'recording') return;
    try {
      const result = await window.vozella.invoke('audio.recording.pause', {});
      if (result.paused) move('paused');
    } catch {
      // The recording goes on; the status line keeps saying so.
    }
  }, [move]);

  const resume = useCallback(async () => {
    if (current.current !== 'paused') return;
    try {
      const result = await window.vozella.invoke('audio.recording.resume', {});
      if (result.resumed) move('recording');
    } catch {
      // Still paused.
    }
  }, [move]);

  /**
   * Ends the take. `failure` is a capture failure already on screen: it stays instead of the saved
   * notice, and a stop error does not replace it (spec items 49 and 57).
   */
  const stopWith = useCallback(
    async (failure: Message | null) => {
      if (current.current !== 'recording' && current.current !== 'paused') return;
      move('stopping');
      let next: TakeNotice | null = null;
      try {
        const result = await window.vozella.invoke('audio.recording.stop', {});
        if (result.error !== null) next = warning('Error_StopRecording', result.error);
        else if (result.path !== null) next = saved(result.path);
      } catch (error) {
        next = warning('Error_StopRecording', errorText(error));
      }
      setNotice(failure ? { tone: 'warning', message: failure } : next);
      move('idle');
    },
    [move],
  );
  const stop = useCallback(() => stopWith(null), [stopWith]);

  const start = useCallback(
    async (title: string, microphone: MicrophoneChoiceDto) => {
      if (current.current !== 'idle') return;
      move('starting');
      early.current = null;
      setNotice(null);
      try {
        const result = await window.vozella.invoke('audio.recording.start', { title, microphone });
        if (result.started) {
          move('recording');
          const failure = takeEarly();
          if (failure) await stopWith(failure);
          return;
        }
        setNotice({
          tone: 'warning',
          message: startFailureMessage(result.code ?? undefined, result.message),
        });
      } catch (error) {
        setNotice(warning('Error_StartRecording', errorText(error)));
      }
      early.current = null;
      move('idle');
    },
    [move, stopWith],
  );

  // A take keeps running in main while the user visits another page. Coming back, the page asks
  // main where the take stands and picks the controls up again (spec items 33, 49, 57, 60).
  useEffect(() => {
    let alive = true;
    window.vozella.invoke('audio.recording.state', {}).then(
      (state) => {
        if (!alive || current.current !== 'idle') return;
        if (state.phase === 'recording' || state.phase === 'paused') move(state.phase);
      },
      () => {
        // No answer: the page starts idle, as before.
      },
    );
    return () => {
      alive = false;
    };
  }, [move]);

  // The page handles only the first output or writer failure: it shows the message and stops.
  // It listens from the start call on: a notice that comes before the start answer is kept and
  // acted on as soon as the take is running.
  const running = phase === 'starting' || phase === 'recording' || phase === 'paused';
  useEffect(() => {
    if (!running) return;
    let handled = false;
    return window.vozella.on('audio.recording.notice', (payload) => {
      if (handled || payload.kind === 'source-lost') return;
      handled = true;
      const failure = noticeMessage(payload);
      if (current.current === 'starting') early.current = failure;
      else void stopWith(failure);
    });
  }, [running, stopWith]);

  const importAudio = useCallback(
    async (title: string) => {
      if (current.current !== 'idle') return;
      move('importing');
      setNotice(null);
      try {
        const picked = await window.vozella.invoke('audio.import.pickFile', {});
        if (picked === null) {
          move('idle');
          return;
        }
        setNotice({ tone: 'info', message: { key: 'Status_Importing', args: [] } });
        const result = await window.vozella.invoke('audio.import.run', { title });
        setNotice(
          result.imported ? saved(result.path) : warning('Error_ImportAudio', result.message),
        );
      } catch (error) {
        setNotice(warning('Error_ImportAudio', errorText(error)));
      }
      move('idle');
    },
    [move],
  );

  return { phase, notice, start, pause, resume, stop, importAudio };
}
