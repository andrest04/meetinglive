import type { SummaryTabStateDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionItemDto, NotesMode } from './summary-tab-model';

export interface SummaryTabModel {
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly state: SummaryTabStateDto | null;
  readonly mode: NotesMode;
  readonly notes: string;
  readonly actionItems: readonly ActionItemDto[];
  /** The last save that failed, until dismissed or the next load. */
  readonly status: string | null;
  readonly setMode: (mode: NotesMode) => void;
  readonly setNotes: (text: string) => void;
  /** Writes the notes now when they differ from what was last saved. */
  readonly flushNotes: () => void;
  readonly toggleAction: (index: number, done: boolean) => void;
  readonly dismissStatus: () => void;
  /** Saves any unsaved notes and resolves once main has them, so a run reads what was typed. */
  readonly settleNotes: () => Promise<void>;
  /** Loads the tab again without the skeleton and without losing unsaved typing. */
  readonly refresh: () => Promise<void>;
  /** A run for this meeting was already going when the tab loaded. */
  readonly runningAtLoad: boolean;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The Summary tab of one meeting (spec 2.2). Main owns the data; this hook loads it, keeps the
 * raw notes and the action item ticks as local state so typing and clicking feel instant, and
 * sends each change back. A save that fails puts the old value back and says so.
 */
export function useSummaryTab(
  meetingId: string | null,
  failedToggleMessage: (detail: string) => string,
): SummaryTabModel {
  const [state, setState] = useState<SummaryTabStateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setModeState] = useState<NotesMode>('enhanced');
  const [notes, setNotesState] = useState('');
  const [actionItems, setActionItems] = useState<readonly ActionItemDto[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [runningAtLoad, setRunningAtLoad] = useState(false);

  // What the notes box holds now, and what main has: they differ while a save is due.
  const notesRef = useRef('');
  const savedRef = useRef('');
  const idRef = useRef<string | null>(null);
  const pendingToggles = useRef(0);
  const savingRef = useRef<Promise<void>>(Promise.resolve());
  const messageRef = useRef(failedToggleMessage);
  messageRef.current = failedToggleMessage;

  const flushNotes = useCallback(() => {
    const id = idRef.current;
    const text = notesRef.current;
    if (id === null || text === savedRef.current) return;
    // Claimed before the answer so a blur and an unmount do not save the same text twice.
    const previous = savedRef.current;
    savedRef.current = text;
    const saving = (async () => {
      try {
        const result = await window.vozella.invoke('summaries.saveNotes', {
          meetingId: id,
          text,
        });
        if (result.status === 'failed' && idRef.current === id && savedRef.current === text) {
          savedRef.current = previous;
        }
      } catch {
        if (idRef.current === id && savedRef.current === text) savedRef.current = previous;
      }
    })();
    savingRef.current = saving;
    void saving;
  }, []);

  const settleNotes = useCallback(async () => {
    flushNotes();
    await savingRef.current;
  }, [flushNotes]);

  const refresh = useCallback(async () => {
    const id = idRef.current;
    if (id === null) return;
    try {
      const answer = await window.vozella.invoke('summaries.loadTab', { meetingId: id });
      if (answer.status !== 'loaded' || idRef.current !== id) return;
      const loaded = answer.state;
      // Typing since the last save stays; otherwise the file's notes win.
      if (notesRef.current === savedRef.current) {
        notesRef.current = loaded.notes;
        savedRef.current = loaded.notes;
        setNotesState(loaded.notes);
      }
      setState(loaded);
      setActionItems(loaded.actionItems);
      setRunningAtLoad(answer.generating);
    } catch {
      // The page keeps what it shows; the next load tries again.
    }
  }, []);

  useEffect(() => {
    const flags = { alive: true };
    setLoading(true);
    setLoadError(null);
    void (async () => {
      try {
        const answer = await window.vozella.invoke('summaries.loadTab', { meetingId });
        if (!flags.alive) return;
        if (answer.status === 'failed') {
          setLoadError(answer.detail);
          setState(null);
        } else {
          const loaded = answer.state;
          idRef.current = loaded.meetingId;
          notesRef.current = loaded.notes;
          savedRef.current = loaded.notes;
          setState(loaded);
          setNotesState(loaded.notes);
          setActionItems(loaded.actionItems);
          setModeState('enhanced');
          setStatus(null);
          setRunningAtLoad(answer.generating);
        }
      } catch (error) {
        if (flags.alive) setLoadError(errorText(error));
      } finally {
        if (flags.alive) setLoading(false);
      }
    })();
    return () => {
      flags.alive = false;
      // Leaving the page or the meeting saves what was typed (item 101).
      flushNotes();
      idRef.current = null;
    };
  }, [meetingId, flushNotes]);

  useEffect(() => {
    const onUnload = (): void => {
      flushNotes();
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [flushNotes]);

  const setNotes = useCallback((text: string) => {
    notesRef.current = text;
    setNotesState(text);
  }, []);

  const setMode = useCallback(
    (next: NotesMode) => {
      if (next === 'enhanced') flushNotes();
      setModeState(next);
    },
    [flushNotes],
  );

  const toggleAction = useCallback((index: number, done: boolean) => {
    const id = idRef.current;
    if (id === null) return;
    const put = (value: boolean): void => {
      setActionItems((items) =>
        items.map((item, at) => (at === index ? { ...item, isDone: value } : item)),
      );
    };
    put(done);
    pendingToggles.current += 1;
    void (async () => {
      let failure: string | null = null;
      try {
        const result = await window.vozella.invoke('summaries.toggleAction', {
          meetingId: id,
          index,
          done,
        });
        if (result.status === 'saved') {
          // The saved list is the truth, unless a later click is still on its way.
          if (pendingToggles.current === 1 && idRef.current === id)
            setActionItems(result.actionItems);
        } else {
          failure = result.status === 'failed' ? result.message : messageRef.current(result.status);
        }
      } catch (error) {
        failure = messageRef.current(errorText(error));
      } finally {
        pendingToggles.current -= 1;
      }
      if (failure !== null && idRef.current === id) {
        put(!done);
        setStatus(failure);
      }
    })();
  }, []);

  const dismissStatus = useCallback(() => {
    setStatus(null);
  }, []);

  return {
    loading,
    loadError,
    state,
    mode,
    notes,
    actionItems,
    status,
    setMode,
    setNotes,
    flushNotes,
    toggleAction,
    dismissStatus,
    settleNotes,
    refresh,
    runningAtLoad,
  };
}
