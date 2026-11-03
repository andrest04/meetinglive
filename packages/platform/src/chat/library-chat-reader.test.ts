import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEETING_CAP, packContext, type MeetingRecord } from '@vozella/core';
import { createLibraryFixture, type LibraryFixture } from '../library/library-test-kit';
import { LibraryChatReader } from './library-chat-reader';

/** B17: chat reads by id and by folder, and never loads every transcript. */
const source = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'library',
  'fixtures',
  'winui-library',
);
const WEEKLY = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const CALCULO = '8e2f1b63-44d5-4a7c-9ba1-1d2e3f4a5b6c';

let fx: LibraryFixture;
beforeEach(() => {
  fx = createLibraryFixture();
  fs.cpSync(source, fx.root, { recursive: true });
  fs.rmSync(path.join(fx.root, '.gitattributes'));
  fs.renameSync(path.join(fx.root, 'folders.json.fixture'), path.join(fx.root, 'folders.json'));
});
afterEach(() => {
  fx.cleanup();
});

const reader = (): LibraryChatReader =>
  new LibraryChatReader({ meetings: fx.meetings, folders: fx.folders });

describe('LibraryChatReader on the WinUI library fixture', () => {
  it('reads one meeting by id with its transcript, and null for an unknown id', async () => {
    const found = await reader().meetingById(WEEKLY);
    expect(found?.title).toBe('Weekly sync: planning');
    expect(found?.transcript ?? '').not.toBe('');
    expect(await reader().meetingById('99999999-9999-9999-9999-999999999999')).toBeNull();
  });

  it('reads the meetings of one folder and the folders with their notes', async () => {
    const inFolder = await reader().meetingsInFolder(CALCULO);
    expect(inFolder.map((m) => m.id)).toEqual([WEEKLY]);
    expect((await reader().meetingsInFolder(CALCULO.toUpperCase())).length).toBe(1);
    const folders = await reader().listFolders();
    expect(folders.map((f) => f.name).sort()).toEqual(['Universidad', 'Cálculo'].sort());
  });

  it('lists every meeting of the library', async () => {
    expect((await reader().listRecent()).length).toBe(2);
  });

  it('finds the stored id from the hex form a citation carries', async () => {
    expect(await reader().findMeetingId(WEEKLY.replace(/-/g, '').toUpperCase())).toBe(WEEKLY);
    expect(await reader().findMeetingId('00000000000000000000000000000000')).toBeNull();
  });
});

describe('LibraryChatReader bound (B17)', () => {
  async function seed(count: number): Promise<MeetingRecord[]> {
    const base = (await fx.meetings.get(WEEKLY))!;
    const records: MeetingRecord[] = [];
    for (let i = 0; i < count; i += 1) {
      const n = String(i).padStart(2, '0');
      const record: MeetingRecord = {
        ...base,
        id: `00000000-0000-0000-0000-0000000000${n}`,
        title: `Bulk ${n}`,
        recordedAt: `2027-01-${String(i + 1).padStart(2, '0')}T10:00:00.0000000+00:00`,
        folderId: null,
        transcript: `[00:00.00-00:01.00] Ana: line ${n}`,
      };
      records.push(await fx.meetings.save(record));
    }
    return records;
  }

  it('parses only the newest 12 records in full and keeps the packer count right', async () => {
    await seed(20);
    const get = vi.spyOn(fx.meetings, 'get');
    const meetings = await reader().listRecent();
    expect(get).toHaveBeenCalledTimes(MEETING_CAP);
    expect(meetings).toHaveLength(22);
    const full = meetings.filter((m) => m.transcript !== null);
    expect(full).toHaveLength(MEETING_CAP);
    expect(full.every((m) => m.title.startsWith('Bulk'))).toBe(true);
    expect(meetings.filter((m) => m.transcript === null)).toHaveLength(10);

    const context = packContext('AllMeetings', null, null, null, meetings, [], (k) => k);
    expect(context).toContain('Showing the 12 most recent of 22 meetings');
    expect(context).toContain('Bulk 19');
    expect(context).not.toContain('Bulk 07');
  });

  it('answers the existence check without parsing a record', async () => {
    await seed(5);
    const get = vi.spyOn(fx.meetings, 'get');
    expect(await reader().findMeetingId(WEEKLY)).toBe(WEEKLY);
    expect(get).not.toHaveBeenCalled();
  });
});
