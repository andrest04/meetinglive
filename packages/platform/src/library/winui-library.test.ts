import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraryFixture, tree, type LibraryFixture } from './library-test-kit';

/**
 * `fixtures/winui-library` was written by the C# JsonFolderRepository and MarkdownMeetingRepository
 * (MeetingLive.Core, run from a throwaway console project against a temp folder), not by hand.
 * Items 155 and 156: the TypeScript side reads it whole and writes it back byte for byte.
 */
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'winui-library');

const files = (root: string): string[] => tree(root).filter((f) => f !== '.gitattributes');

let fx: LibraryFixture;
let again: LibraryFixture;
beforeEach(() => {
  fx = createLibraryFixture();
  again = createLibraryFixture();
  fs.cpSync(source, fx.root, { recursive: true });
  fs.rmSync(path.join(fx.root, '.gitattributes'));
  // Stored as .fixture so Prettier leaves the C# bytes alone.
  fs.renameSync(path.join(fx.root, 'folders.json.fixture'), path.join(fx.root, 'folders.json'));
});
afterEach(() => {
  fx.cleanup();
  again.cleanup();
});

describe('a library written by the WinUI app', () => {
  it('item 155: opens with every folder, meeting field, note, color and icon', async () => {
    const folders = await fx.folders.getAll();
    expect(folders).toEqual([
      {
        id: '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b',
        name: 'Universidad',
        parentId: null,
        note: 'Fall term\nline two',
        colorKey: 'teal',
        iconKey: 'book',
        createdAt: '2026-08-01T10:00:00-05:00',
      },
      {
        id: '8e2f1b63-44d5-4a7c-9ba1-1d2e3f4a5b6c',
        name: 'Cálculo',
        parentId: '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b',
        note: null,
        colorKey: 'purple',
        iconKey: null,
        createdAt: '2026-08-02T10:00:00-05:00',
      },
    ]);
    const list = await fx.meetings.list();
    expect(list.skipped).toEqual([]);
    expect(list.items.map((m) => m.title).sort()).toEqual(['Standup', 'Weekly sync: planning']);
    const weekly = await fx.meetings.get('3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d');
    expect(weekly).toMatchObject({
      id: '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d',
      folderId: '8e2f1b63-44d5-4a7c-9ba1-1d2e3f4a5b6c',
      recordedAt: '2026-09-01T12:00:00.0000000-05:00',
      endedAt: '2026-09-01T13:45:00.0000000-05:00',
      summaryProvider: 'local',
      noteTemplateId: 'one-on-one',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
      attendees: ['Ana Perez', 'Luis Gomez'],
      brief: 'Two open questions.',
      transcript: '[00:00:03] Ana: Hello everyone.',
      summary: '### Notes\nHello\n\n## Decisions\nShip it',
      notes: 'Remember the exam date.',
      followUp: 'Subject: recap',
      projectPlan: '### Steps\nShip',
      actionItems: [
        { text: 'Follow up with Luis', isDone: false },
        { text: 'Send the notes', isDone: true },
      ],
    });
  });

  it('item 156: writing the same records back reproduces the C# files byte for byte', async () => {
    for (const f of await fx.folders.getAll()) await again.folders.save(f);
    for (const item of (await fx.meetings.list()).items) {
      const record = await fx.meetings.get(item.id);
      if (record) await again.meetings.save(record);
    }
    expect(files(again.root)).toEqual(files(fx.root));
    for (const rel of files(fx.root)) {
      const a = fs.readFileSync(path.join(fx.root, rel));
      const b = fs.readFileSync(path.join(again.root, rel));
      expect(b.equals(a), rel).toBe(true);
    }
  });
});
