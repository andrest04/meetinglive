import { describe, expect, it } from 'vitest';
import type { FolderRecord } from './folder';
import {
  ALL_VIEW,
  INBOX_VIEW,
  canDeleteFolder,
  emptyFlags,
  folderView,
  selectMeetings,
  type LibrarySnapshot,
} from './library-view';
import type { MeetingListItem } from './meeting';

const folder = (id: string, parentId: string | null = null): FolderRecord => ({
  id,
  name: id,
  parentId,
  note: null,
  colorKey: null,
  iconKey: null,
  createdAt: '2026-09-01T12:00:00+00:00',
});
const item = (
  id: string,
  title: string,
  recordedAt: string,
  folderId: string | null = null,
): MeetingListItem => ({
  id,
  title,
  recordedAt,
  endedAt: null,
  folderId,
  snippet: '',
  hasSummary: false,
  hasTranscript: false,
  busy: false,
});

const snapshot: LibrarySnapshot = {
  folders: [folder('a'), folder('b', 'a')],
  meetings: [
    item('1', 'Standup', '2026-09-01T10:00:00.0000000+00:00'),
    item('2', 'Planning', '2026-09-03T10:00:00.0000000+00:00', 'a'),
    item('3', 'Dangling', '2026-09-02T10:00:00.0000000+00:00', 'gone'),
    item('4', 'standup two', '2026-09-04T10:00:00.0000000+00:00', 'a'),
    item('5', 'Earlier by instant', '2026-09-04T09:00:00.0000000+05:00', 'a'),
  ],
};

describe('selectMeetings', () => {
  it('Inbox holds unfiled meetings and those whose folder is unknown, newest first', () => {
    const { meetings, inFolderCount } = selectMeetings(snapshot, INBOX_VIEW, '');
    expect(meetings.map((m) => m.id)).toEqual(['3', '1']);
    expect(inFolderCount).toBe(2);
  });

  it('a folder holds exactly its own meetings, sorted by instant, not by text', () => {
    expect(selectMeetings(snapshot, folderView('a'), '').meetings.map((m) => m.id)).toEqual([
      '4',
      '5',
      '2',
    ]);
  });

  it('searches titles only: trimmed, case-insensitive substring; count ignores the query', () => {
    const result = selectMeetings(snapshot, folderView('a'), '  STANDUP ');
    expect(result.meetings.map((m) => m.id)).toEqual(['4']);
    expect(result.inFolderCount).toBe(3);
  });

  it('does not search snippets', () => {
    const snap = {
      ...snapshot,
      meetings: [{ ...item('9', 'Title', '2026-09-01T10:00:00+00:00'), snippet: 'needle' }],
    };
    expect(selectMeetings(snap, INBOX_VIEW, 'needle').meetings).toEqual([]);
  });

  it('All holds every meeting, newest first, whatever its folder', () => {
    const { meetings, inFolderCount } = selectMeetings(snapshot, ALL_VIEW, '');
    expect(meetings.map((m) => m.id)).toEqual(['4', '5', '2', '3', '1']);
    expect(inFolderCount).toBe(5);
  });

  it('matches titles without regard to accents', () => {
    const snap = {
      folders: [],
      meetings: [item('1', 'Revisión del año', '2026-09-01T10:00:00+00:00')],
    };
    expect(selectMeetings(snap, ALL_VIEW, 'REVISION').meetings).toHaveLength(1);
    expect(selectMeetings(snap, ALL_VIEW, 'año').meetings).toHaveLength(1);
    expect(selectMeetings(snap, ALL_VIEW, 'ano').meetings).toHaveLength(1);
  });

  it('needs every word of the query in the title, in any order', () => {
    expect(selectMeetings(snapshot, ALL_VIEW, 'two standup').meetings.map((m) => m.id)).toEqual([
      '4',
    ]);
    expect(selectMeetings(snapshot, ALL_VIEW, 'standup three').meetings).toEqual([]);
  });
});

describe('emptyFlags truth table', () => {
  const base = {
    isLoading: false,
    isInboxSelected: true,
    inFolderCount: 0,
    folderCount: 0,
    totalMeetings: 0,
    displayedCount: 0,
    query: '',
  };

  it('an empty library shows only the library message', () => {
    expect(emptyFlags(base)).toEqual({
      showLibraryEmpty: true,
      showInboxEmpty: false,
      showFolderEmpty: false,
      showNoMatches: false,
      hasMeetings: false,
      isEmpty: true,
    });
  });

  it('an empty Inbox in a library that has folders shows the inbox message', () => {
    expect(emptyFlags({ ...base, folderCount: 1 })).toMatchObject({
      showLibraryEmpty: false,
      showInboxEmpty: true,
    });
  });

  it('an empty Inbox when meetings exist elsewhere shows the inbox message', () => {
    expect(emptyFlags({ ...base, totalMeetings: 3 })).toMatchObject({
      showLibraryEmpty: false,
      showInboxEmpty: true,
    });
  });

  it('an empty folder shows the folder message', () => {
    expect(emptyFlags({ ...base, isInboxSelected: false, folderCount: 2 })).toMatchObject({
      showFolderEmpty: true,
      showInboxEmpty: false,
      showLibraryEmpty: false,
    });
  });

  it('shows nothing while loading', () => {
    expect(emptyFlags({ ...base, isLoading: true })).toMatchObject({
      showLibraryEmpty: false,
      showInboxEmpty: false,
      showFolderEmpty: false,
      isEmpty: false,
    });
  });

  it('B15: a search with no matches reports it', () => {
    const flags = emptyFlags({ ...base, inFolderCount: 4, totalMeetings: 4, query: 'zzz' });
    expect(flags.showNoMatches).toBe(true);
    expect(flags.showInboxEmpty).toBe(false);
    expect(
      emptyFlags({ ...base, inFolderCount: 4, displayedCount: 1, query: 'a' }).showNoMatches,
    ).toBe(false);
    expect(emptyFlags({ ...base, inFolderCount: 4, query: '   ' }).showNoMatches).toBe(false);
  });

  it('has meetings when something is displayed', () => {
    expect(emptyFlags({ ...base, displayedCount: 2, inFolderCount: 2 })).toMatchObject({
      hasMeetings: true,
      isEmpty: false,
    });
  });
});

describe('canDeleteFolder', () => {
  it('blocks folders with children or meetings', () => {
    expect(canDeleteFolder(snapshot, 'a')).toEqual({ allowed: false, reason: 'not-empty' });
  });

  it('allows an empty leaf', () => {
    expect(canDeleteFolder(snapshot, 'b')).toEqual({ allowed: true });
  });

  it('reports an unknown folder', () => {
    expect(canDeleteFolder(snapshot, 'zzz')).toEqual({ allowed: false, reason: 'not-found' });
  });
});
