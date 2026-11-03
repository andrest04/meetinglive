import { useCallback, useEffect, useState } from 'react';

export interface NotepadState {
  /** Spec 2.9: shown while recording or processing. */
  readonly visible: boolean;
  /** The notes main holds. */
  readonly notes: string;
  /** Pushes the text to main (`recording.setNotes`). */
  readonly setNotes: (text: string) => void;
}

/**
 * The session notes as main publishes them. Main owns the text: it clears it at Start and Discard
 * (B-10), so the page only mirrors `recording.state` and sends edits back.
 */
export function useNotepad(): NotepadState {
  const [visible, setVisible] = useState(false);
  const [notes, setLocalNotes] = useState('');

  useEffect(() => {
    let alive = true;
    const apply = (state: { isRecording: boolean; isProcessing: boolean; notes: string }): void => {
      if (!alive) return;
      setVisible(state.isRecording || state.isProcessing);
      setLocalNotes(state.notes);
    };
    const off = window.vozella.on('recording.state', apply);
    void window.vozella
      .invoke('recording.getState', {})
      .then(apply)
      .catch(() => {
        // Nothing is shown until main publishes a state.
      });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setNotes = useCallback((text: string) => {
    void window.vozella.invoke('recording.setNotes', { text }).catch(() => {
      // Main keeps the last accepted text; the next edit sends the whole text again.
    });
  }, []);

  return { visible, notes, setNotes };
}
