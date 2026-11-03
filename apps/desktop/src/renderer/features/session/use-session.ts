import { createSlideTracker, type SessionTab, type SlideDirection } from '@vozella/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export type SessionPhase = 'loading' | 'error' | 'loaded' | 'empty';

export interface SessionMeetingView {
  readonly id: string;
  readonly title: string;
  readonly hasTranscript: boolean;
  readonly hasAudio: boolean;
}

export interface SessionModel {
  readonly phase: SessionPhase;
  /** Null unless a meeting is loaded. Header and tabs read this one value (B6). */
  readonly meeting: SessionMeetingView | null;
  readonly tab: SessionTab;
  /** Set by a tab change only; a reload after a rename does not slide. */
  readonly slide: SlideDirection | null;
  /** Changes when the inner tab content must be rebuilt from disk (after a rename). */
  readonly contentKey: number;
  readonly selectTab: (tab: SessionTab) => void;
  readonly reloadContent: () => void;
  /** Re-reads the record now and keeps the page in place. */
  readonly refresh: () => void;
  readonly retry: () => void;
}

/**
 * Resolves the meeting id once from the workspace and loads the view for it. Every async result
 * is checked against a sequence number, so a slow read for a meeting the user already left is
 * dropped (parity 14). Header and tabs share the one id (B6).
 */
export function useSession(): SessionModel {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [meeting, setMeeting] = useState<SessionMeetingView | null>(null);
  const [tab, setTab] = useState<SessionTab>('Transcript');
  const [slide, setSlide] = useState<SlideDirection | null>(null);
  const [contentKey, setContentKey] = useState(0);

  const idRef = useRef<string | null>(null);
  const tabRef = useRef<SessionTab>('Transcript');
  const started = useRef(false);
  const sequence = useRef(0);
  const tracker = useRef<ReturnType<typeof createSlideTracker> | null>(null);

  const load = useCallback(async (id: string | null, quiet: boolean): Promise<void> => {
    const mine = (sequence.current += 1);
    if (id === null) {
      setMeeting(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    if (!quiet) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const view = await window.vozella.invoke('session.getView', { id });
      if (mine !== sequence.current) return;
      setFailed(false);
      setMeeting(
        view.record === null
          ? null
          : {
              id,
              title: view.record.title,
              hasTranscript: view.hasTranscript,
              hasAudio: view.hasAudio,
            },
      );
    } catch {
      // A quiet refresh keeps what is on screen; a full load shows the error line.
      if (mine === sequence.current && !quiet) {
        setMeeting(null);
        setFailed(true);
      }
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, []);

  const applyTab = useCallback((next: SessionTab): void => {
    tracker.current ??= createSlideTracker(next);
    if (next === tabRef.current) return;
    tabRef.current = next;
    setSlide(tracker.current.navigate(next));
    setTab(next);
  }, []);

  useEffect(() => {
    const apply = (state: { selectedMeetingId: string | null; sessionTab: SessionTab }): void => {
      const first = !started.current;
      started.current = true;
      if (first) {
        tabRef.current = state.sessionTab;
        tracker.current = createSlideTracker(state.sessionTab);
        setTab(state.sessionTab);
      } else {
        applyTab(state.sessionTab);
      }
      if (first || state.selectedMeetingId !== idRef.current) {
        idRef.current = state.selectedMeetingId;
        void load(state.selectedMeetingId, false);
      }
    };
    let alive = true;
    void window.vozella
      .invoke('workspace.getState', {})
      .then((state) => {
        // A change event may already have started the page; getState then adds nothing.
        if (alive && !started.current) apply(state);
      })
      .catch(() => {
        if (!alive) return;
        started.current = true;
        setFailed(true);
        setLoading(false);
      });
    const offChanged = window.vozella.on('workspace.changed', ({ state }) => {
      apply(state);
    });
    // Opening a session patches the stored tab without a state event; the navigation request
    // that follows is the signal to read it again (a related meeting opened from this page).
    const offNavigation = window.vozella.on('workspace.navigationRequested', ({ tag }) => {
      if (tag !== 'Session') return;
      void window.vozella.invoke('workspace.getState', {}).then(
        (state) => {
          if (alive && started.current) applyTab(state.sessionTab);
        },
        () => undefined,
      );
    });
    const offMeeting = window.vozella.on('workspace.meetingChanged', ({ id }) => {
      if (id === idRef.current) void load(id, true);
    });
    const offDeleted = window.vozella.on('workspace.meetingDeleted', ({ id }) => {
      if (id !== idRef.current) return;
      // B20: the meeting is gone; drop any read still in flight and show the empty state.
      sequence.current += 1;
      idRef.current = null;
      setMeeting(null);
      setFailed(false);
      setLoading(false);
    });
    return () => {
      alive = false;
      offChanged();
      offNavigation();
      offMeeting();
      offDeleted();
    };
  }, [applyTab, load]);

  const selectTab = useCallback(
    (next: SessionTab) => {
      applyTab(next);
      void window.vozella.invoke('workspace.dispatch', {
        action: { type: 'setSessionTab', tab: next },
      });
    },
    [applyTab],
  );

  const reloadContent = useCallback(() => {
    setSlide(null);
    setContentKey((key) => key + 1);
  }, []);

  const refresh = useCallback(() => {
    if (idRef.current !== null) void load(idRef.current, true);
  }, [load]);

  const retry = useCallback(() => {
    void load(idRef.current, false);
  }, [load]);

  const phase: SessionPhase = loading
    ? 'loading'
    : failed
      ? 'error'
      : meeting === null
        ? 'empty'
        : 'loaded';

  return { phase, meeting, tab, slide, contentKey, selectTab, reloadContent, refresh, retry };
}
