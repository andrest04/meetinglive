import type { FolderRecord } from './folder';
import type { MeetingListItem } from './meeting';
import { parseOffsetDate } from './offset-date';

/** Everything the Library page shows, as of the last load. */
export interface LibrarySnapshot {
  readonly folders: readonly FolderRecord[];
  readonly meetings: readonly MeetingListItem[];
}

function instant(item: MeetingListItem): number {
  return parseOffsetDate(item.recordedAt)?.ms ?? 0;
}

export interface MeetingSelection {
  readonly meetings: readonly MeetingListItem[];
  /** Meetings in the selected container before the search filter. */
  readonly inFolderCount: number;
}

/**
 * Spec 3.13 `ApplyMeetingFilter`. `folderId` null is Inbox, which also holds meetings whose
 * folder id is not in the folder set. Newest first; the query matches titles only.
 */
export function selectMeetings(
  snapshot: LibrarySnapshot,
  folderId: string | null,
  query: string,
): MeetingSelection {
  const known = new Set(snapshot.folders.map((f) => f.id));
  const inContainer = snapshot.meetings.filter((m) =>
    folderId === null ? m.folderId === null || !known.has(m.folderId) : m.folderId === folderId,
  );
  const needle = query.trim().toLowerCase();
  const matching =
    needle === '' ? inContainer : inContainer.filter((m) => m.title.toLowerCase().includes(needle));
  return {
    meetings: [...matching].sort((a, b) => instant(b) - instant(a)),
    inFolderCount: inContainer.length,
  };
}

export interface EmptyFlagsInput {
  readonly isLoading: boolean;
  readonly isInboxSelected: boolean;
  readonly inFolderCount: number;
  readonly folderCount: number;
  readonly totalMeetings: number;
  readonly displayedCount: number;
  readonly query: string;
}

export interface EmptyFlags {
  readonly showLibraryEmpty: boolean;
  readonly showInboxEmpty: boolean;
  readonly showFolderEmpty: boolean;
  /** B15: a search matched nothing in a container that has meetings. */
  readonly showNoMatches: boolean;
  readonly hasMeetings: boolean;
  readonly isEmpty: boolean;
}

/** Spec 2.9, plus the no-matches message the WinUI page lacked. */
export function emptyFlags(input: EmptyFlagsInput): EmptyFlags {
  const inboxEmpty = input.isInboxSelected && input.inFolderCount === 0;
  const showLibraryEmpty =
    !input.isLoading && inboxEmpty && input.folderCount === 0 && input.totalMeetings === 0;
  const hasMeetings = input.displayedCount > 0;
  return {
    showLibraryEmpty,
    showInboxEmpty: !input.isLoading && inboxEmpty && !showLibraryEmpty,
    showFolderEmpty: !input.isLoading && !input.isInboxSelected && input.inFolderCount === 0,
    showNoMatches:
      !input.isLoading &&
      input.query.trim() !== '' &&
      input.inFolderCount > 0 &&
      input.displayedCount === 0,
    hasMeetings,
    isEmpty: !input.isLoading && !hasMeetings,
  };
}

export type DeleteFolderCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'not-empty' | 'not-found' };

/** A folder can go only when it has no child folders and no meetings filed in it. */
export function canDeleteFolder(snapshot: LibrarySnapshot, folderId: string): DeleteFolderCheck {
  if (!snapshot.folders.some((f) => f.id === folderId))
    return { allowed: false, reason: 'not-found' };
  const busy =
    snapshot.folders.some((f) => f.parentId === folderId) ||
    snapshot.meetings.some((m) => m.folderId === folderId);
  return busy ? { allowed: false, reason: 'not-empty' } : { allowed: true };
}
