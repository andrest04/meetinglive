import {
  buildBreadcrumbs,
  buildFolderTree,
  canDeleteFolder,
  emptyFlags,
  expandedAncestors,
  flattenFolderPaths,
  folderView,
  INBOX_VIEW,
  selectMeetings,
  type Breadcrumb,
  type EmptyFlags,
  type FolderNode,
  type MoveDestination,
} from '@vozella/core';
import type { FailureReasonDto, FolderDto, MeetingListItemDto } from '@vozella/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StringKey } from '../../i18n/translate';

/** A message for the status bar: a catalog key and the values for its placeholders. */
export interface StatusMessage {
  readonly key: StringKey;
  readonly args: readonly string[];
}

export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
}

export interface LoadProblem {
  readonly reason: FailureReasonDto;
  readonly message: string | undefined;
}

interface FailureResult {
  readonly ok: false;
  readonly reason: FailureReasonDto;
  readonly message?: string | undefined;
}
export type FolderResult = { readonly ok: true; readonly folder: FolderDto } | FailureResult;

export interface LibraryModel {
  readonly isLoading: boolean;
  readonly problem: LoadProblem | null;
  /** Files the last load could not read as meetings, with the reason. */
  readonly skipped: readonly SkippedFile[];
  readonly folders: readonly FolderDto[];
  readonly tree: readonly FolderNode[];
  readonly selectedFolder: FolderDto | null;
  readonly selectedId: string | null;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly meetings: readonly MeetingListItemDto[];
  readonly flags: EmptyFlags;
  readonly query: string;
  readonly noteText: string;
  readonly expandedIds: ReadonlySet<string>;
  readonly status: StatusMessage | null;
  readonly destinations: readonly MoveDestination[];
  readonly setQuery: (value: string) => void;
  readonly setNoteText: (value: string) => void;
  readonly saveNote: () => Promise<void>;
  readonly setExpandedIds: (ids: ReadonlySet<string>) => void;
  readonly dismissStatus: () => void;
  readonly showStatus: (message: StatusMessage) => void;
  readonly selectFolder: (id: string | null) => void;
  readonly createFolder: (name: string) => Promise<FolderResult>;
  readonly renameFolder: (id: string, name: string) => Promise<FolderResult>;
  readonly updatePersonality: (
    id: string,
    colorKey: string,
    iconKey: string,
  ) => Promise<FolderResult>;
  readonly deleteFolder: (id: string) => Promise<'deleted' | 'not-empty' | 'failed'>;
  /** Checks the in-memory snapshot, like the WinUI page. */
  readonly canDeleteFolder: (id: string) => boolean;
  readonly moveMeeting: (meetingId: string, folderId: string | null) => Promise<boolean>;
  /** Refuses a busy meeting before the dialog opens. True when the dialog may open. */
  readonly beginDelete: (meetingId: string) => Promise<boolean>;
  readonly deleteMeeting: (meetingId: string) => Promise<void>;
  readonly openMeeting: (meetingId: string, tab: 'Transcript' | 'Summary') => void;
  readonly goRecord: () => void;
}

/** Idle time after the last keystroke before the folder note is stored. */
export const NOTE_AUTOSAVE_MS = 400;

function noteOf(folder: FolderDto | undefined): string {
  return folder?.note ?? '';
}

/**
 * The Library container state: what the last load returned, the selection, the search text and
 * the folder note, plus every mutation. Rules live in `@vozella/core`; storage in the main process.
 */
export function useLibrary(locale: string, inboxLabel: string): LibraryModel {
  const [isLoading, setIsLoading] = useState(true);
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [skipped, setSkipped] = useState<readonly SkippedFile[]>([]);
  const [folders, setFolders] = useState<readonly FolderDto[]>([]);
  const [allMeetings, setAllMeetings] = useState<readonly MeetingListItemDto[]>([]);
  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [noteText, setNoteTextState] = useState('');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<StatusMessage | null>(null);

  // Live values for code that outlives a render: unload handlers and async callbacks.
  const foldersRef = useRef<readonly FolderDto[]>([]);
  const selectedRef = useRef<string | null>(null);
  const noteRef = useRef('');
  const loadSeq = useRef(0);
  // The first load can be replaced by a live refresh; the stored selection must still land.
  const selectionApplied = useRef(false);

  const setSelected = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedIdState(id);
  }, []);

  const setNoteText = useCallback((value: string) => {
    noteRef.current = value;
    setNoteTextState(value);
  }, []);

  /** Spec 3.13 PersistSelectedFolderNote: trimmed, blank is null, unchanged is a no-op. */
  const persistNote = useCallback(async (): Promise<void> => {
    const id = selectedRef.current;
    if (id === null) return;
    const folder = foldersRef.current.find((f) => f.id === id);
    if (!folder) return;
    const text = noteRef.current.trim();
    const next = text === '' ? null : text;
    if (next === folder.note) return;
    // Remember what was stored right away: the change event that follows reloads, and that reload
    // must not find the note still "unsaved" and save it again.
    foldersRef.current = foldersRef.current.map((f) => (f.id === id ? { ...f, note: next } : f));
    const result = await window.vozella.invoke('library.setFolderNote', { id, note: next });
    if (!result.ok) {
      foldersRef.current = foldersRef.current.map((f) =>
        f.id === id ? { ...f, note: folder.note } : f,
      );
    }
  }, []);

  const refresh = useCallback(
    async (restore?: string | null, firstLoad = false): Promise<void> => {
      loadSeq.current += 1;
      const seq = loadSeq.current;
      if (firstLoad) setIsLoading(true);
      try {
        await persistNote();
        // What the user had typed when the load began: a character typed while the load is in
        // flight must survive the reply (B16).
        const typedAtStart = noteRef.current;
        const result = await window.vozella.invoke('library.load', {});
        if (seq !== loadSeq.current) return;
        if (!result.ok) {
          setProblem({ reason: result.reason, message: result.message });
          return;
        }
        setProblem(null);
        foldersRef.current = result.folders;
        setFolders(result.folders);
        setAllMeetings(result.meetings);
        setSkipped(result.skipped);
        const wanted = restore === undefined ? selectedRef.current : restore;
        const folder = wanted === null ? undefined : result.folders.find((f) => f.id === wanted);
        const next = folder ? folder.id : null;
        if (next !== selectedRef.current || firstLoad || !selectionApplied.current) {
          selectionApplied.current = true;
          setSelected(next);
          void window.vozella.invoke('workspace.dispatch', {
            action: { type: 'publishSelectedFolder', folderId: next },
          });
        }
        // The save above made the stored note match the text box, so only a different folder or
        // an outside edit changes it; never rewrite what the user is typing.
        if (noteRef.current === typedAtStart && noteRef.current.trim() !== noteOf(folder).trim()) {
          setNoteText(noteOf(folder));
        }
        // Only widen: the expansion the user chose stays (B14).
        const ancestors = expandedAncestors(result.folders, next);
        setExpandedIds((current) => new Set([...current, ...ancestors]));
      } finally {
        if (seq === loadSeq.current) setIsLoading(false);
      }
    },
    [persistNote, setNoteText, setSelected],
  );

  // Autosave while typing (B16): a window closed from the last-window path destroys the renderer
  // before a page-hide invoke can reach main, so the note must already be stored by then.
  useEffect(() => {
    const timer = setTimeout(() => {
      void persistNote();
    }, NOTE_AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [noteText, persistNote]);

  // First load, live refresh, and the save of the note when the page goes away (B16).
  useEffect(() => {
    const live = { current: true };
    void (async () => {
      let restored: string | null = null;
      try {
        const state = await window.vozella.invoke('workspace.getState', {});
        restored = state.selectedFolderId;
      } catch {
        // No saved selection: open on the Inbox rather than leaving the skeleton up.
      }
      if (!live.current) return;
      selectedRef.current = restored;
      await refresh(restored, true);
    })();
    const offChanged = window.vozella.on('library.changed', () => {
      void refresh();
    });
    const flush = (): void => {
      void persistNote();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      live.current = false;
      offChanged();
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [refresh, persistNote]);

  const selectFolder = useCallback(
    (id: string | null) => {
      if (id === selectedRef.current) return;
      const folder = foldersRef.current.find((f) => f.id === id);
      const next = folder ? folder.id : null;
      // Persist against the folder being left, then switch. Set the new id first so a second
      // click while the save is in flight cannot persist the new folder's note under the old one.
      const leaving = persistNote();
      setSelected(next);
      setNoteText(noteOf(folder));
      const ancestors = expandedAncestors(foldersRef.current, next);
      setExpandedIds((current) => new Set([...current, ...ancestors]));
      void leaving.then(() =>
        window.vozella.invoke('workspace.dispatch', {
          action: { type: 'publishSelectedFolder', folderId: next },
        }),
      );
    },
    [persistNote, setNoteText, setSelected],
  );

  const snapshot = useMemo(() => ({ folders, meetings: allMeetings }), [folders, allMeetings]);
  const selection = useMemo(
    () =>
      selectMeetings(snapshot, selectedId === null ? INBOX_VIEW : folderView(selectedId), query),
    [snapshot, selectedId, query],
  );
  const flags = useMemo(
    () =>
      emptyFlags({
        isLoading,
        isInboxSelected: selectedId === null,
        inFolderCount: selection.inFolderCount,
        folderCount: folders.length,
        totalMeetings: allMeetings.length,
        displayedCount: selection.meetings.length,
        query,
      }),
    [isLoading, selectedId, selection, folders.length, allMeetings.length, query],
  );
  const tree = useMemo(() => buildFolderTree(folders, locale), [folders, locale]);
  const breadcrumbs = useMemo(() => buildBreadcrumbs(folders, selectedId), [folders, selectedId]);
  const destinations = useMemo(
    () => flattenFolderPaths(folders, inboxLabel, locale),
    [folders, inboxLabel, locale],
  );
  const selectedFolder = folders.find((f) => f.id === selectedId) ?? null;

  const folderFailed = useCallback((result: FailureResult): void => {
    setStatus({ key: 'Ui_LibraryFolderFailed', args: [result.message ?? result.reason] });
  }, []);

  const changeFolder = useCallback(
    async (run: () => Promise<FolderResult>): Promise<FolderResult> => {
      await persistNote();
      const result = await run();
      if (result.ok) await refresh(result.folder.id);
      else if (result.reason !== 'name-taken' && result.reason !== 'empty-name') {
        folderFailed(result);
      }
      return result;
    },
    [persistNote, refresh, folderFailed],
  );

  return {
    isLoading,
    problem,
    skipped,
    folders,
    tree,
    selectedFolder,
    selectedId,
    breadcrumbs,
    meetings: selection.meetings,
    flags,
    query,
    noteText,
    expandedIds,
    status,
    destinations,
    setQuery,
    setNoteText,
    saveNote: persistNote,
    setExpandedIds,
    dismissStatus: () => {
      setStatus(null);
    },
    showStatus: setStatus,
    selectFolder,
    createFolder: (name) =>
      changeFolder(() =>
        window.vozella.invoke('library.createFolder', { name, parentId: selectedRef.current }),
      ),
    renameFolder: (id, name) =>
      changeFolder(() => window.vozella.invoke('library.renameFolder', { id, name })),
    updatePersonality: (id, colorKey, iconKey) =>
      changeFolder(() =>
        window.vozella.invoke('library.updateFolderPersonality', { id, colorKey, iconKey }),
      ),
    canDeleteFolder: (id) => canDeleteFolder(snapshot, id).allowed,
    deleteFolder: async (id) => {
      await persistNote();
      const result = await window.vozella.invoke('library.deleteFolder', { id });
      if (result.ok) {
        await refresh(null);
        return 'deleted';
      }
      await refresh();
      if (result.reason === 'not-empty') {
        setStatus({ key: 'LibraryDeleteFolder_NotEmpty', args: [] });
        return 'not-empty';
      }
      folderFailed(result);
      return 'failed';
    },
    moveMeeting: async (meetingId, folderId) => {
      const result = await window.vozella.invoke('library.moveMeeting', { meetingId, folderId });
      await refresh();
      if (result.ok) return true;
      setStatus(
        result.reason === 'busy'
          ? { key: 'HistoryDelete_Busy', args: [] }
          : { key: 'Ui_LibraryMoveFailed', args: [result.message ?? result.reason] },
      );
      return false;
    },
    beginDelete: async (meetingId) => {
      const { busy } = await window.vozella.invoke('library.isMeetingBusy', { meetingId });
      if (busy) setStatus({ key: 'HistoryDelete_Busy', args: [] });
      return !busy;
    },
    deleteMeeting: async (meetingId) => {
      const result = await window.vozella.invoke('library.deleteMeeting', { meetingId });
      if (!result.ok) {
        setStatus(
          result.reason === 'busy'
            ? { key: 'HistoryDelete_Busy', args: [] }
            : { key: 'HistoryDelete_Failed', args: [result.message ?? result.reason] },
        );
      }
      await refresh();
    },
    openMeeting: (meetingId, tab) => {
      void (async () => {
        await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'selectMeeting', id: meetingId },
        });
        await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'openSession', tab },
        });
      })();
    },
    goRecord: () => {
      void window.vozella.invoke('workspace.dispatch', {
        action: { type: 'navigateTo', tag: 'Recording' },
      });
    },
  };
}
