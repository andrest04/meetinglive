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
export function useRecordingFeedback(listening: boolean): RecordingFeedback {
  const [warning, setWarning] = useState<Message | null>(null);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!listening) {
      setWarning(null);
      setLevel(0);
      return;
    }
    let alive = true;
    // Warnings raised while the page was away are still true: show them again.
    window.vozella.invoke('audio.recording.state', {}).then(
      (state) => {
        if (!alive) return;
        // A host that answers without the list (an older build) just has none to replay.
        for (const notice of Array.isArray(state.notices) ? state.notices : []) {
          setWarning((current) => chooseWarning(current, noticeMessage(notice)));
        }
      },
      () => {
        // No answer: only live notices are shown.
      },
    );
    const offNotice = window.vozella.on('audio.recording.notice', (notice) => {
      setWarning((current) => chooseWarning(current, noticeMessage(notice)));
    });
    const offLevel = window.vozella.on('audio.recording.level', (payload) => {
      setLevel(Math.min(100, Math.max(0, payload.level)));
    });
    return () => {
      alive = false;
      offNotice();
      offLevel();
    };
  }, [listening]);

  return { warning, level };
}
