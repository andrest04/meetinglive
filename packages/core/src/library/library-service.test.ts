import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../clock';
import type { FolderRecord } from './folder';
import { InMemoryFolderRepository, InMemoryMeetingRepository } from './in-memory-library';
import { LibraryService } from './library-service';
import { LibraryFileCorruptError } from './errors';
import type { MeetingRecord } from './meeting';
import { MeetingBusyRegistry } from './ports';

const NOW = new Date('2026-09-05T15:00:00.000Z');
const clock: Clock = { now: () => NOW };

const meeting = (id: string, folderId: string | null = null, title = id): MeetingRecord => ({
  id,
  title,
  recordedAt: '2026-09-01T12:00:00.0000000+00:00',
  endedAt: null,
  audioFilePath: '',
  sourcePath: null,
  folderId,
  summaryProvider: null,
  calendarEventId: null,
  calendarId: null,
  seriesId: null,
  joinUrl: null,
  noteTemplateId: null,
  attendees: [],
  brief: null,
  transcript: null,
  summary: null,
  actionItems: [],
  jevAnalysis: null,
  notes: null,
  followUp: null,
  projectPlan: null,
});

const folder = (id: string, name: string, parentId: string | null = null): FolderRecord => ({
  id,
  name,
  parentId,
  note: null,
  colorKey: null,
  iconKey: null,
  createdAt: '2026-09-01T12:00:00+00:00',
});

function setup() {
  const meetings = new InMemoryMeetingRepository();
  const folders = new InMemoryFolderRepository();
  const busy = new MeetingBusyRegistry();
  let counter = 0;
  const service = new LibraryService({
    meetings,
    folders,
    busy,
    clock,
    newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  });
  return { meetings, folders, busy, service };
}

describe('createFolder', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('creates a root folder with an auto color, no icon, no note and the current time', async () => {
    const result = await t.service.createFolder({ name: '  Universidad ', parentId: null });
    expect(result).toMatchObject({
      ok: true,
      folder: {
        name: 'Universidad',
        parentId: null,
        note: null,
        iconKey: null,
        colorKey: 'blue',
        createdAt: expect.stringMatching(
          /^2026-09-05T\d{2}:\d{2}:00(\.0+)?[+-]\d{2}:\d{2}$/,
        ) as string,
      },
    });
    expect(t.folders.folders).toHaveLength(1);
  });

  it('gives each new folder the next unused color', async () => {
    await t.service.createFolder({ name: 'A', parentId: null });
    const second = await t.service.createFolder({ name: 'B', parentId: null });
    expect(second).toMatchObject({ ok: true, folder: { colorKey: 'teal' } });
  });

  it('creates a child of the given folder', async () => {
    const parent = await t.service.createFolder({ name: 'P', parentId: null });
    if (!parent.ok) throw new Error('setup');
    const child = await t.service.createFolder({ name: 'C', parentId: parent.folder.id });
    expect(child).toMatchObject({ ok: true, folder: { parentId: parent.folder.id } });
  });

  it('rejects an empty or whitespace name', async () => {
    expect(await t.service.createFolder({ name: '   ', parentId: null })).toEqual({
      ok: false,
      reason: 'empty-name',
    });
  });

  it('rejects an unknown parent', async () => {
    expect(await t.service.createFolder({ name: 'X', parentId: 'nope' })).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('B7: rejects duplicate sibling names, ignoring case', async () => {
    await t.service.createFolder({ name: 'Trabajo', parentId: null });
    expect(await t.service.createFolder({ name: 'trabajo', parentId: null })).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });
  });

  it('B7: rejects names that sanitize to the same directory', async () => {
    await t.service.createFolder({ name: 'A/B', parentId: null });
    expect(await t.service.createFolder({ name: 'A:B', parentId: null })).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });
  });

  it('B7: rejects a name that lands on a reserved directory', async () => {
    await t.service.createFolder({ name: 'Meetings folder', parentId: null });
    expect(await t.service.createFolder({ name: 'Meetings', parentId: null })).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });
  });

  it('allows the same name under a different parent', async () => {
    const a = await t.service.createFolder({ name: 'A', parentId: null });
    const b = await t.service.createFolder({ name: 'B', parentId: null });
    if (!a.ok || !b.ok) throw new Error('setup');
    expect((await t.service.createFolder({ name: 'Notes', parentId: a.folder.id })).ok).toBe(true);
    expect((await t.service.createFolder({ name: 'Notes', parentId: b.folder.id })).ok).toBe(true);
  });
});

describe('renameFolder', () => {
  it('renames and keeps every other field', async () => {
    const t = setup();
    t.folders.folders = [{ ...folder('a', 'Old'), note: 'n', colorKey: 'red' }];
    const result = await t.service.renameFolder({ id: 'a', name: ' New ' });
    expect(result).toMatchObject({ ok: true, folder: { name: 'New', note: 'n', colorKey: 'red' } });
    expect(t.folders.folders[0]?.name).toBe('New');
  });

  it('allows a case-only rename', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'trabajo')];
    expect((await t.service.renameFolder({ id: 'a', name: 'Trabajo' })).ok).toBe(true);
  });

  it('B7: refuses to rename onto a sibling', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A'), folder('b', 'B')];
    expect(await t.service.renameFolder({ id: 'b', name: 'a' })).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });
    expect(t.folders.folders[1]?.name).toBe('B');
  });

  it('B7 with B26b: an orphan folder shown as a root blocks a real root of the same name', async () => {
    const t = setup();
    t.folders.folders = [folder('o', 'Trabajo', 'gone'), folder('r', 'Otro')];
    expect(await t.service.createFolder({ name: 'trabajo', parentId: null })).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });
    expect(await t.service.renameFolder({ id: 'r', name: 'TRABAJO' })).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });
    t.folders.folders = [folder('o', 'Trabajo', 'gone'), folder('p', 'Trabajo2', 'gone')];
    expect(await t.service.renameFolder({ id: 'p', name: 'trabajo' })).toMatchObject({
      ok: false,
      reason: 'name-taken',
    });
  });

  it('B13: a failed save leaves nothing changed in memory or in the store', async () => {
    const t = setup();
    const original = folder('a', 'Old');
    t.folders.folders = [original];
    t.folders.save = () => Promise.reject(new Error('EBUSY: locked'));
    const result = await t.service.renameFolder({ id: 'a', name: 'New' });
    expect(result).toMatchObject({ ok: false, reason: 'io-failed' });
    expect(t.folders.folders[0]).toBe(original);
  });

  it('rejects empty names and unknown folders', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A')];
    expect(await t.service.renameFolder({ id: 'a', name: ' ' })).toMatchObject({
      reason: 'empty-name',
    });
    expect(await t.service.renameFolder({ id: 'zz', name: 'x' })).toMatchObject({
      reason: 'not-found',
    });
  });
});

describe('personality and note', () => {
  it('stores resolved keys', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A')];
    const result = await t.service.updatePersonality({
      id: 'a',
      colorKey: 'PURPLE',
      iconKey: 'Book',
    });
    expect(result).toMatchObject({ ok: true, folder: { colorKey: 'purple', iconKey: 'book' } });
  });

  it('an unknown icon resolves to folder and an unset color to the deterministic one', async () => {
    const t = setup();
    t.folders.folders = [folder('7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b', 'A')];
    const result = await t.service.updatePersonality({
      id: '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b',
      colorKey: null,
      iconKey: 'zzz',
    });
    expect(result).toMatchObject({ ok: true, folder: { colorKey: 'orange', iconKey: 'folder' } });
  });

  it('trims the note and stores blank as null', async () => {
    const t = setup();
    t.folders.folders = [{ ...folder('a', 'A'), note: 'old' }];
    await t.service.setFolderNote({ id: 'a', note: '  hello  ' });
    expect(t.folders.folders[0]?.note).toBe('hello');
    await t.service.setFolderNote({ id: 'a', note: '   ' });
    expect(t.folders.folders[0]?.note).toBeNull();
  });

  it('does not save an unchanged note', async () => {
    const t = setup();
    t.folders.folders = [{ ...folder('a', 'A'), note: 'same' }];
    let saves = 0;
    const save = t.folders.save.bind(t.folders);
    t.folders.save = (f) => {
      saves += 1;
      return save(f);
    };
    expect(await t.service.setFolderNote({ id: 'a', note: ' same ' })).toMatchObject({ ok: true });
    expect(saves).toBe(0);
  });

  it('ignores an unknown folder for notes, as when the folder was deleted meanwhile', async () => {
    const t = setup();
    expect(await t.service.setFolderNote({ id: 'gone', note: 'x' })).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });
});

describe('deleteFolder', () => {
  it('deletes an empty folder', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A')];
    expect(await t.service.deleteFolder('a')).toEqual({ ok: true });
    expect(t.folders.folders).toEqual([]);
  });

  it('refuses a folder with a child or a meeting', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A'), folder('b', 'B', 'a')];
    expect(await t.service.deleteFolder('a')).toMatchObject({ ok: false, reason: 'not-empty' });
    t.meetings.records.set('m', meeting('m', 'b'));
    expect(await t.service.deleteFolder('b')).toMatchObject({ ok: false, reason: 'not-empty' });
    expect(t.folders.folders).toHaveLength(2);
  });

  it('B26: re-checks against fresh data, so a meeting filed after the page loaded blocks the delete', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A')];
    await t.service.load(); // the page's snapshot says the folder is empty
    t.meetings.records.set('late', meeting('late', 'a'));
    expect(await t.service.deleteFolder('a')).toMatchObject({ ok: false, reason: 'not-empty' });
    expect(t.folders.folders).toHaveLength(1);
  });

  it('reports an unknown folder', async () => {
    expect(await setup().service.deleteFolder('zz')).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });
});

describe('moveMeeting', () => {
  it('re-saves the full record with the new folder, also when it is the same folder', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A')];
    t.meetings.records.set('m', { ...meeting('m'), transcript: 'keep me' });
    const result = await t.service.moveMeeting({ meetingId: 'm', folderId: 'a' });
    expect(result).toMatchObject({ ok: true });
    expect(t.meetings.records.get('m')).toMatchObject({ folderId: 'a', transcript: 'keep me' });
    expect(await t.service.moveMeeting({ meetingId: 'm', folderId: 'a' })).toMatchObject({
      ok: true,
    });
  });

  it('moves to Inbox with a null folder id', async () => {
    const t = setup();
    t.meetings.records.set('m', meeting('m', 'a'));
    await t.service.moveMeeting({ meetingId: 'm', folderId: null });
    expect(t.meetings.records.get('m')?.folderId).toBeNull();
  });

  it('B13: refuses a meeting that is being recorded or processed', async () => {
    const t = setup();
    t.meetings.records.set('m', meeting('m'));
    t.busy.register({ isBusy: (id) => id === 'm' });
    expect(await t.service.moveMeeting({ meetingId: 'm', folderId: null })).toMatchObject({
      ok: false,
      reason: 'busy',
    });
  });

  it('reports an unknown meeting or destination, and save failures', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A')];
    expect(await t.service.moveMeeting({ meetingId: 'zz', folderId: null })).toMatchObject({
      reason: 'not-found',
    });
    t.meetings.records.set('m', meeting('m'));
    expect(await t.service.moveMeeting({ meetingId: 'm', folderId: 'zz' })).toMatchObject({
      reason: 'not-found',
    });
    t.meetings.save = () => Promise.reject(new Error('EBUSY: locked'));
    expect(await t.service.moveMeeting({ meetingId: 'm', folderId: 'a' })).toMatchObject({
      ok: false,
      reason: 'io-failed',
      message: 'EBUSY: locked',
    });
  });
});

describe('deleteMeeting', () => {
  it('deletes and reports success', async () => {
    const t = setup();
    t.meetings.records.set('m', meeting('m'));
    expect(await t.service.deleteMeeting('m')).toEqual({ ok: true });
    expect(t.meetings.records.size).toBe(0);
  });

  it('refuses a busy meeting before touching anything', async () => {
    const t = setup();
    t.meetings.records.set('m', meeting('m'));
    t.busy.register({ isBusy: () => true });
    expect(await t.service.deleteMeeting('m')).toMatchObject({ ok: false, reason: 'busy' });
    expect(t.meetings.records.size).toBe(1);
  });

  it('a locked file is an io failure with the message, and the meeting stays', async () => {
    const t = setup();
    t.meetings.records.set('m', meeting('m'));
    t.meetings.lockedIds.add('m');
    expect(await t.service.deleteMeeting('m')).toEqual({
      ok: false,
      reason: 'io-failed',
      message: 'EBUSY: resource busy or locked',
    });
    expect(t.meetings.records.size).toBe(1);
  });

  it('an unknown id succeeds without error', async () => {
    expect(await setup().service.deleteMeeting('zz')).toEqual({ ok: true });
  });

  it('says so when the Recycle Bin refused, and the meeting stays', async () => {
    const t = setup();
    t.meetings.records.set('m', meeting('m'));
    t.meetings.trashRefusedIds.add('m');
    expect(await t.service.deleteMeeting('m')).toMatchObject({
      ok: false,
      reason: 'trash-failed',
    });
    expect(t.meetings.records.size).toBe(1);
  });

  it('a permanent delete does not depend on the Recycle Bin', async () => {
    const t = setup();
    t.meetings.records.set('m', meeting('m'));
    t.meetings.trashRefusedIds.add('m');
    expect(await t.service.deleteMeeting('m', 'permanent')).toEqual({ ok: true });
    expect(t.meetings.records.size).toBe(0);
  });
});

describe('load', () => {
  it('returns folders and the light meeting list', async () => {
    const t = setup();
    t.folders.folders = [folder('a', 'A')];
    t.meetings.records.set('m', { ...meeting('m', 'a'), summary: '# T\nBody text' });
    const result = await t.service.load();
    expect(result).toMatchObject({
      ok: true,
      folders: [{ id: 'a' }],
      meetings: [{ id: 'm', folderId: 'a', snippet: 'Body text' }],
      skipped: [],
    });
  });

  it('tells the list how long a meeting ran, what it holds and whether it is busy', async () => {
    const t = setup();
    t.meetings.records.set('m', {
      ...meeting('m'),
      endedAt: '2026-09-01T12:45:00.0000000+00:00',
      summary: 'Body',
      transcript: '  ',
    });
    t.meetings.records.set('n', { ...meeting('n'), transcript: 'Spoken' });
    t.busy.register({ isBusy: (id) => id === 'n' });
    const result = await t.service.load();
    if (!result.ok) throw new Error('load failed');
    expect(result.meetings).toEqual([
      expect.objectContaining({
        id: 'm',
        endedAt: '2026-09-01T12:45:00.0000000+00:00',
        hasSummary: true,
        hasTranscript: false,
        busy: false,
      }),
      expect.objectContaining({
        id: 'n',
        endedAt: null,
        hasSummary: false,
        hasTranscript: true,
        busy: true,
      }),
    ]);
  });

  it('B5: reports a damaged folders file instead of throwing', async () => {
    const t = setup();
    t.folders.getAll = () => Promise.reject(new LibraryFileCorruptError('folders', 'bad'));
    expect(await t.service.load()).toMatchObject({ ok: false, reason: 'corrupt' });
  });
});
