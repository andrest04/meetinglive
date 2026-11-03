import type { MicrophoneChoiceDto } from '@vozella/contracts';
import { useCallback, useRef, useState } from 'react';
import { startFailureMessage, type Message } from '../audio/recording-status';

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

  const move = useCallback((next: TakePhase) => {
    current.current = next;
    setPhase(next);
  }, []);

  const start = useCallback(
    async (title: string, microphone: MicrophoneChoiceDto) => {
      if (current.current !== 'idle') return;
      move('starting');
      setNotice(null);
      try {
        const result = await window.vozella.invoke('audio.recording.start', { title, microphone });
        if (result.started) {
          move('recording');
          return;
        }
        setNotice({
          tone: 'warning',
          message: startFailureMessage(result.code ?? undefined, result.message),
        });
      } catch (error) {
        setNotice(warning('Error_StartRecording', errorText(error)));
      }
      move('idle');
    },
    [move],
  );

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

  const stop = useCallback(async () => {
    if (current.current !== 'recording' && current.current !== 'paused') return;
    move('stopping');
    try {
      const result = await window.vozella.invoke('audio.recording.stop', {});
      if (result.error !== null) setNotice(warning('Error_StopRecording', result.error));
      else if (result.path !== null) setNotice(saved(result.path));
      else setNotice(null);
    } catch (error) {
      setNotice(warning('Error_StopRecording', errorText(error)));
    }
    move('idle');
  }, [move]);

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
