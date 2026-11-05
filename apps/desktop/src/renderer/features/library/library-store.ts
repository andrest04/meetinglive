import {
  ALL_VIEW,
  expandedAncestors,
  folderView,
  INBOX_VIEW,
  isInLibraryView,
  type LibraryView,
} from '@vozella/core';
import type { FailureReasonDto, FolderDto, MeetingListItemDto } from '@vozella/contracts';
import { create } from 'zustand';

export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
}

export interface LoadProblem {
  readonly reason: FailureReasonDto;
  readonly message: string | undefined;
}

/** A folder action chosen in the sidebar. The route owns the dialogs, so it carries them out. */
export type FolderRequest =
  | { readonly kind: 'new' }
  | { readonly kind: 'rename' | 'personality' | 'delete'; readonly folderId: string };

/** Meetings dropped on a folder in the sidebar. The route moves them, and offers Undo. */
export interface DropRequest {
  readonly meetingIds: readonly string[];
  readonly folderId: string | null;
}

/** Marks a drag as meetings. The ids stay here: `getData` is not available during `dragover`. */
export const MEETINGS_DRAG_TYPE = 'application/x-vozella-meetings';

export interface LibraryState {
  readonly isLoading: boolean;
  readonly problem: LoadProblem | null;
  /** Files the last load could not read as meetings, with the reason. */
  readonly skipped: readonly SkippedFile[];
  readonly folders: readonly FolderDto[];
  readonly meetings: readonly MeetingListItemDto[];
  readonly view: LibraryView;
  readonly expandedIds: ReadonlySet<string>;
  /** The row the keyboard is on. It survives leaving the route, so coming back lands on it. */
  readonly cursorId: string | null;
  readonly scrollOffset: number;
  readonly folderRequest: FolderRequest | null;
  /** The meetings being dragged. These rows stay rendered: removing the source ends a drag. */
  readonly draggedIds: readonly string[];
  readonly dropRequest: DropRequest | null;
}

const INITIAL: LibraryState = {
  isLoading: true,
  problem: null,
  skipped: [],
  folders: [],
  meetings: [],
  view: ALL_VIEW,
  expandedIds: new Set(),
  cursorId: null,
  scrollOffset: 0,
  folderRequest: null,
  draggedIds: [],
  dropRequest: null,
};

export const useLibraryStore = create<LibraryState>(() => INITIAL);

const { getState: get, setState: set } = useLibraryStore;

/** Coalesces the burst of changes one operation broadcasts: a load costs real time at 3,000. */
export const REFRESH_DEBOUNCE_MS = 150;

/**
 * The folder note lives with the route, but its text must be stored around every load and every
 * change of view, in this order, so typing is never lost (B16).
 */
export interface FolderNoteParticipant {
  readonly beforeLoad: () => Promise<void>;
  readonly afterLoad: (folders: readonly FolderDto[], selected: FolderDto | undefined) => void;
  /** Called synchronously before the view changes; the promise settles when the note is stored. */
  readonly leave: () => Promise<void>;
  readonly entered: (selected: FolderDto | undefined) => void;
}

let note: FolderNoteParticipant | null = null;
let loadSeq = 0;
// The first load can be replaced by a live refresh; the stored selection must still land.
let selectionApplied = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function registerFolderNote(participant: FolderNoteParticipant): () => void {
  note = participant;
  return () => {
    if (note === participant) note = null;
  };
}

/** All and Inbox both publish null: the distinction lives here, not in the workspace. */
export const folderIdOfView = (view: LibraryView): string | null =>
  view.kind === 'folder' ? view.id : null;

const sameView = (a: LibraryView, b: LibraryView): boolean =>
  a.kind === b.kind && folderIdOfView(a) === folderIdOfView(b);

const folderOfView = (view: LibraryView, folders: readonly FolderDto[]): FolderDto | undefined =>
  folders.find((f) => f.id === folderIdOfView(view));

function publish(folderId: string | null): void {
  void window.vozella.invoke('workspace.dispatch', {
    action: { type: 'publishSelectedFolder', folderId },
  });
}

function cancelScheduledRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

async function load(restore: LibraryView | undefined, firstLoad: boolean): Promise<void> {
  cancelScheduledRefresh();
  loadSeq += 1;
  const seq = loadSeq;
  if (firstLoad) set({ isLoading: true });
  try {
    await note?.beforeLoad();
    const result = await window.vozella.invoke('library.load', {});
    if (seq !== loadSeq) return;
    if (!result.ok) {
      set({ problem: { reason: result.reason, message: result.message } });
      return;
    }
    const current = get();
    const wanted = restore ?? current.view;
    // A folder that went away lands on the Inbox (#107).
    const view =
      wanted.kind === 'folder' && !folderOfView(wanted, result.folders) ? INBOX_VIEW : wanted;
    const next = folderIdOfView(view);
    // Only widen: the expansion the user chose stays (B14).
    const ancestors = expandedAncestors(result.folders, next);
    set({
      problem: null,
      folders: result.folders,
      meetings: result.meetings,
      skipped: result.skipped,
      view,
      expandedIds: new Set([...current.expandedIds, ...ancestors]),
    });
    if (next !== folderIdOfView(current.view) || firstLoad || !selectionApplied) {
      selectionApplied = true;
      publish(next);
    }
    note?.afterLoad(result.folders, folderOfView(view, result.folders));
  } finally {
    if (seq === loadSeq) set({ isLoading: false });
  }
}

/** Loads now. `restore` selects that view once the load lands. */
export function refreshLibrary(restore?: LibraryView): Promise<void> {
  return load(restore, false);
}

function scheduleRefresh(): void {
  cancelScheduledRefresh();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void load(undefined, false);
  }, REFRESH_DEBOUNCE_MS);
}

function whenIdle(run: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(run, { timeout: 500 });
    return () => {
      window.cancelIdleCallback(handle);
    };
  }
  const timer = setTimeout(run, 0);
  return () => {
    clearTimeout(timer);
  };
}

let connections = 0;
let disconnect: (() => void) | null = null;

/** Connected once from the shell. The first load waits for idle, because it runs on every route. */
export function connectLibrary(): () => void {
  connections += 1;
  if (connections === 1) {
    let live = true;
    const offChanged = window.vozella.on('library.changed', scheduleRefresh);
    const cancelIdle = whenIdle(() => {
      void (async () => {
        let restored: string | null = null;
        try {
          const state = await window.vozella.invoke('workspace.getState', {});
          restored = state.selectedFolderId;
        } catch {
          // No saved selection: open on All rather than leaving the skeleton up.
        }
        if (!live) return;
        const view = restored === null ? ALL_VIEW : folderView(restored);
        set({ view });
        await load(view, true);
      })();
    });
    disconnect = () => {
      live = false;
      offChanged();
      cancelIdle();
      cancelScheduledRefresh();
      loadSeq += 1;
      selectionApplied = false;
      set(INITIAL, true);
    };
  }
  return () => {
    connections -= 1;
    if (connections === 0) {
      disconnect?.();
      disconnect = null;
    }
  };
}

/** Choosing what is already shown does nothing, so a note being typed stays untouched (item 85). */
export function selectView(wanted: LibraryView): void {
  const current = get();
  const folder = folderOfView(wanted, current.folders);
  const view = wanted.kind === 'folder' && !folder ? INBOX_VIEW : wanted;
  if (sameView(view, current.view)) return;
  const next = folderIdOfView(view);
  // Store the note against the folder being left, then switch. The new id is set first so a second
  // click while the save is in flight cannot store the new folder's note under the old one.
  const leaving = note?.leave() ?? Promise.resolve();
  const ancestors = expandedAncestors(current.folders, next);
  set({
    view,
    cursorId: null,
    scrollOffset: 0,
    expandedIds: new Set([...current.expandedIds, ...ancestors]),
  });
  note?.entered(folder);
  if (next !== folderIdOfView(current.view)) {
    void leaving.then(() => {
      publish(next);
    });
  }
}

export function setExpandedIds(expandedIds: ReadonlySet<string>): void {
  set({ expandedIds });
}

export function requestFolderAction(folderRequest: FolderRequest): void {
  set({ folderRequest });
}

export function clearFolderRequest(): void {
  set({ folderRequest: null });
}

export function setDragged(draggedIds: readonly string[]): void {
  set({ draggedIds });
}

export function requestDrop(dropRequest: DropRequest): void {
  set({ dropRequest });
}

export function clearDropRequest(): void {
  set({ dropRequest: null });
}

export function setCursor(cursorId: string | null): void {
  set({ cursorId });
}

/** Nothing renders from this: it is read once, when the list comes back. */
export function rememberScroll(scrollOffset: number): void {
  set({ scrollOffset });
}

export interface DirectCounts {
  readonly all: number;
  readonly inbox: number;
  readonly byFolder: ReadonlyMap<string, number>;
}

/** Each container counts only its own meetings, so a parent does not include its children. */
export function directCounts(
  folders: readonly Pick<FolderDto, 'id'>[],
  meetings: readonly Pick<MeetingListItemDto, 'folderId'>[],
): DirectCounts {
  const known = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string, number>();
  let inbox = 0;
  for (const meeting of meetings) {
    if (isInLibraryView(INBOX_VIEW, known, meeting)) inbox += 1;
    else if (meeting.folderId !== null) {
      byFolder.set(meeting.folderId, (byFolder.get(meeting.folderId) ?? 0) + 1);
    }
  }
  return { all: meetings.length, inbox, byFolder };
}
