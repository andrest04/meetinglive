import { useEffect, useState } from 'react';
import { chooseWarning, noticeMessage, type Message } from './recording-status';

export interface RecordingFeedback {
  /** The warning or failure to show over the status line, or null. It outlives a pause. */
  readonly warning: Message | null;
  /** Microphone level of the running recording, 0..100. */
  readonly level: number;
}

/**
 * What the capture service tells the page while a recording runs: the level of the microphone and
 * the notices (spec 2.3.3). A warning stays until the recording ends; "no source left" is never
 * replaced by a milder one that arrives after it.
 */
export function useRecordingFeedback(recording: boolean): RecordingFeedback {
  const [warning, setWarning] = useState<Message | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!recording) {
      setWarning(null);
      setLevel(0);
      return;
    }
    const offNotice = window.vozella.on('audio.recording.notice', (notice) => {
      setWarning((current) => chooseWarning(current, noticeMessage(notice)));
    });
    const offLevel = window.vozella.on('audio.recording.level', (payload) => {
      setLevel(Math.min(100, Math.max(0, payload.level)));
    });
    return () => {
      offNotice();
      offLevel();
    };
  }, [recording]);

  return { warning, level };
}
