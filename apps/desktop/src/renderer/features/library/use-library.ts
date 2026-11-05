import {
  buildBreadcrumbs,
  canDeleteFolder,
  emptyFlags,
  flattenFolderPaths,
  folderView,
  INBOX_VIEW,
  selectMeetings,
  type Breadcrumb,
  type EmptyFlags,
  type LibraryView,
  type MoveDestination,
} from '@vozella/core';
import type {
  FailureReasonDto,
  FolderDto,
  MeetingDeleteModeDto,
  MeetingListItemDto,
} from '@vozella/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StringKey } from '../../i18n/translate';
import {
  folderIdOfView,
  refreshLibrary,
  selectView,
  useLibraryStore,
  type LoadProblem,
  type SkippedFile,
} from './library-store';
import { useFolderNote } from './use-folder-note';

export { NOTE_AUTOSAVE_MS } from './use-folder-note';

/** A message for the status bar: a catalog key and the values for its placeholders. */
export interface StatusMessage {
  readonly key: StringKey;
  readonly args: readonly string[];
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
  readonly skipped: readonly SkippedFile[];
  readonly folders: readonly FolderDto[];
  readonly view: LibraryView;
  readonly selectedFolder: FolderDto | null;
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly meetings: readonly MeetingListItemDto[];
  /** Meetings in the view before the search filter. */
  readonly viewCount: number;
  readonly flags: EmptyFlags;
  readonly query: string;
  readonly noteText: string;
  readonly status: StatusMessage | null;
  readonly destinations: readonly MoveDestination[];
  readonly setQuery: (value: string) => void;
  readonly setNoteText: (value: string) => void;
  readonly saveNote: () => Promise<void>;
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
  /** `trash-failed` means nothing was deleted and a permanent delete can be offered. */
  readonly deleteMeeting: (
    meetingId: string,
    mode?: MeetingDeleteModeDto,
  ) => Promise<'deleted' | 'trash-failed' | 'failed'>;
  readonly openMeeting: (meetingId: string, tab: 'Transcript' | 'Summary') => void;
  readonly goRecord: () => void;
}

/**
 * What the Library route works with: the store's last load seen through the current view and search
 * text, plus every mutation. Rules live in `@vozella/core`; storage in the main process.
 */
export function useLibrary(locale: string, inboxLabel: string): LibraryModel {
  const isLoading = useLibraryStore((state) => state.isLoading);
  const problem = useLibraryStore((state) => state.problem);
  const skipped = useLibraryStore((state) => state.skipped);
  const folders = useLibraryStore((state) => state.folders);
  const allMeetings = useLibraryStore((state) => state.meetings);
  const view = useLibraryStore((state) => state.view);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const { noteText, setNoteText, saveNote } = useFolderNote();

  // The store outlives the route, but opening the Library has always read the folder again, so
  // files that appeared without a change event still show up.
  useEffect(() => {
    if (!useLibraryStore.getState().isLoading) void refreshLibrary();
  }, []);

  const selectedId = folderIdOfView(view);
  const snapshot = useMemo(() => ({ folders, meetings: allMeetings }), [folders, allMeetings]);
  const selection = useMemo(() => selectMeetings(snapshot, view, query), [snapshot, view, query]);
  const flags = useMemo(
    () =>
      emptyFlags({
        isLoading,
        // All has no copy of its own: when it is empty, nothing has been recorded.
        isInboxSelected: view.kind !== 'folder',
        inFolderCount: selection.inFolderCount,
        folderCount: view.kind === 'all' ? 0 : folders.length,
        totalMeetings: allMeetings.length,
        displayedCount: selection.meetings.length,
        query,
      }),
    [isLoading, view.kind, selection, folders.length, allMeetings.length, query],
  );
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
      await saveNote();
      const result = await run();
      if (result.ok) await refreshLibrary(folderView(result.folder.id));
      else if (result.reason !== 'name-taken' && result.reason !== 'empty-name') {
        folderFailed(result);
      }
      return result;
    },
    [saveNote, folderFailed],
  );

  return {
    isLoading,
    problem,
    skipped,
    folders,
    view,
    selectedFolder,
    breadcrumbs,
    meetings: selection.meetings,
    viewCount: selection.inFolderCount,
    flags,
    query,
    noteText,
    status,
    destinations,
    setQuery,
    setNoteText,
    saveNote,
    dismissStatus: () => {
      setStatus(null);
    },
    showStatus: setStatus,
    selectFolder: (id) => {
      selectView(id === null ? INBOX_VIEW : folderView(id));
    },
    createFolder: (name) =>
      changeFolder(() =>
        window.vozella.invoke('library.createFolder', {
          name,
          parentId: folderIdOfView(useLibraryStore.getState().view),
        }),
      ),
    renameFolder: (id, name) =>
      changeFolder(() => window.vozella.invoke('library.renameFolder', { id, name })),
    updatePersonality: (id, colorKey, iconKey) =>
      changeFolder(() =>
        window.vozella.invoke('library.updateFolderPersonality', { id, colorKey, iconKey }),
      ),
    canDeleteFolder: (id) => canDeleteFolder(snapshot, id).allowed,
    deleteFolder: async (id) => {
      await saveNote();
      const result = await window.vozella.invoke('library.deleteFolder', { id });
      if (result.ok) {
        await refreshLibrary(INBOX_VIEW);
        return 'deleted';
      }
      await refreshLibrary();
      if (result.reason === 'not-empty') {
        setStatus({ key: 'LibraryDeleteFolder_NotEmpty', args: [] });
        return 'not-empty';
      }
      folderFailed(result);
      return 'failed';
    },
    moveMeeting: async (meetingId, folderId) => {
      const result = await window.vozella.invoke('library.moveMeeting', { meetingId, folderId });
      await refreshLibrary();
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
    deleteMeeting: async (meetingId, mode = 'trash') => {
      const result = await window.vozella.invoke('library.deleteMeeting', { meetingId, mode });
      if (!result.ok && result.reason !== 'trash-failed') {
        setStatus(
          result.reason === 'busy'
            ? { key: 'HistoryDelete_Busy', args: [] }
            : { key: 'HistoryDelete_Failed', args: [result.message ?? result.reason] },
        );
      }
      await refreshLibrary();
      if (result.ok) return 'deleted';
      return result.reason === 'trash-failed' ? 'trash-failed' : 'failed';
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
