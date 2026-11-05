import type { FolderRecord } from './folder';
import type { MeetingListItem } from './meeting';
import { parseOffsetDate } from './offset-date';
import { foldText, foldedWords, hasAllWords } from './text-fold';

/** Everything the Library page shows, as of the last load. */
export interface LibrarySnapshot {
  readonly folders: readonly FolderRecord[];
  readonly meetings: readonly MeetingListItem[];
}

/** When the meeting was recorded, for sorting. Offsets count, so text order is not enough. */
export function meetingInstant(item: Pick<MeetingListItem, 'recordedAt'>): number {
  return parseOffsetDate(item.recordedAt)?.ms ?? 0;
}

/** What the Library is showing: every meeting, the Inbox, or one folder's own meetings. */
export type LibraryView =
  | { readonly kind: 'all' }
  | { readonly kind: 'inbox' }
  | { readonly kind: 'folder'; readonly id: string };

export const ALL_VIEW: LibraryView = { kind: 'all' };
export const INBOX_VIEW: LibraryView = { kind: 'inbox' };
export const folderView = (id: string): LibraryView => ({ kind: 'folder', id });

/** The Inbox also holds meetings whose folder id is not in the folder set. */
export function isInLibraryView(
  view: LibraryView,
  knownFolderIds: ReadonlySet<string>,
  meeting: Pick<MeetingListItem, 'folderId'>,
): boolean {
  switch (view.kind) {
    case 'all':
      return true;
    case 'inbox':
      return meeting.folderId === null || !knownFolderIds.has(meeting.folderId);
    case 'folder':
      return meeting.folderId === view.id;
  }
}

export interface MeetingSelection {
  readonly meetings: readonly MeetingListItem[];
  /** Meetings in the selected container before the search filter. */
  readonly inFolderCount: number;
}

/**
 * Spec 3.13 `ApplyMeetingFilter`. Newest first; the query matches titles only, every word of it
 * in any order and without regard to case or accents.
 */
export function selectMeetings(
  snapshot: LibrarySnapshot,
  view: LibraryView,
  query: string,
): MeetingSelection {
  const known = new Set(snapshot.folders.map((f) => f.id));
  const inContainer = snapshot.meetings.filter((m) => isInLibraryView(view, known, m));
  const words = foldedWords(query);
  const matching =
    words.length === 0
      ? inContainer
      : inContainer.filter((m) => hasAllWords(foldText(m.title), words));
  return {
    meetings: [...matching].sort((a, b) => meetingInstant(b) - meetingInstant(a)),
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
