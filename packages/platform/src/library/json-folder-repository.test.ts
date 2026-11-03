import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryFileCorruptError, renderMeetingMarkdown } from '@vozella/core';
import { JsonFolderRepository } from './json-folder-repository';
import { MarkdownMeetingRepository } from './markdown-meeting-repository';
import {
  FOLDER_1,
  FOLDER_2,
  ID_A,
  ID_B,
  createLibraryFixture,
  folder,
  meeting,
  tree,
  type LibraryFixture,
} from './library-test-kit';

let fx: LibraryFixture;
beforeEach(() => {
  fx = createLibraryFixture();
});
afterEach(() => {
  fx.cleanup();
});

describe('basics', () => {
  it('a missing file reads as no folders', async () => {
    expect(await fx.folders.getAll()).toEqual([]);
  });

  it('save creates the directory immediately and round-trips', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    expect(fs.existsSync(path.join(fx.root, 'Universidad'))).toBe(true);
    expect(await fx.folders.getAll()).toEqual([folder(FOLDER_1, 'Universidad')]);
  });

  it('saving the same id again replaces the record', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    await fx.folders.save({ ...folder(FOLDER_1, 'Universidad'), note: 'Fall' });
    const all = await fx.folders.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.note).toBe('Fall');
  });

  it('writes the file with CRLF and 2-space indentation like the WinUI app', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Año'));
    const text = fs.readFileSync(fx.paths.foldersFilePath, 'utf8');
    expect(text.startsWith('[\r\n  {\r\n    "id": ')).toBe(true);
    expect(text).toContain('"name": "A\\u00F1o"');
  });

  it('delete removes the record and the empty directory', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    await fx.folders.delete(FOLDER_1);
    expect(await fx.folders.getAll()).toEqual([]);
    expect(fs.existsSync(path.join(fx.root, 'Universidad'))).toBe(false);
  });

  it('delete keeps a directory that still holds files', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    fs.writeFileSync(path.join(fx.root, 'Universidad', 'keep.txt'), 'x');
    await fx.folders.delete(FOLDER_1);
    expect(fs.existsSync(path.join(fx.root, 'Universidad', 'keep.txt'))).toBe(true);
    expect(await fx.folders.getAll()).toEqual([]);
  });

  it('71: delete does not look at child folders or filed meetings', async () => {
    const child = '0b8e6f31-5c2a-4d77-9e10-aa11bb22cc33';
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    await fx.folders.save(folder(child, 'Calculo', FOLDER_1));
    await fx.folders.delete(FOLDER_1);
    const left = await fx.folders.getAll();
    expect(left.map((f) => f.id)).toEqual([child]);
    // The child directory is on disk, so the parent directory stays too.
    expect(fs.existsSync(path.join(fx.root, 'Universidad', 'Calculo'))).toBe(true);
  });

  it('delete of a folder that is gone does nothing, not even a write', async () => {
    await fx.folders.delete(FOLDER_1);
    expect(fs.existsSync(fx.paths.foldersFilePath)).toBe(false);
  });

  it('B5: a damaged file raises a typed error and is never overwritten', async () => {
    fs.writeFileSync(fx.paths.foldersFilePath, '{oops');
    await expect(fx.folders.getAll()).rejects.toBeInstanceOf(LibraryFileCorruptError);
    await expect(fx.folders.save(folder(FOLDER_1, 'X'))).rejects.toBeInstanceOf(
      LibraryFileCorruptError,
    );
    expect(fs.readFileSync(fx.paths.foldersFilePath, 'utf8')).toBe('{oops');
  });

  it('reads a file the WinUI app wrote (CRLF, escapes)', async () => {
    fs.writeFileSync(
      fx.paths.foldersFilePath,
      `[\r\n  {\r\n    "id": "${FOLDER_1}",\r\n    "name": "A\\u00F1o",\r\n    "parentId": null,\r\n    "note": null,\r\n    "colorKey": "teal",\r\n    "iconKey": null,\r\n    "createdAt": "2026-09-01T12:00:00-05:00"\r\n  }\r\n]`,
    );
    expect((await fx.folders.getAll())[0]?.name).toBe('Año');
  });
});

describe('directory mirror', () => {
  it('rename moves the directory and its meetings, and rewrites audioFilePath', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Old'));
    const first = await fx.meetings.save(meeting({ folderId: FOLDER_1 }));
    const wav = first.sourcePath?.replace(/\.md$/, '.wav') ?? '';
    fs.writeFileSync(wav, 'RIFF');
    await fx.meetings.save({ ...first, audioFilePath: wav });

    await fx.folders.save(folder(FOLDER_1, 'New'));

    expect(tree(fx.root)).toEqual([
      'New/2026-09-01 Standup.md',
      'New/2026-09-01 Standup.wav',
      'folders.json',
    ]);
    expect((await fx.meetings.get(ID_A))?.audioFilePath).toBe(
      path.join(fx.root, 'New', '2026-09-01 Standup.wav'),
    );
    expect(fs.existsSync(path.join(fx.root, 'Old'))).toBe(false);
  });

  it('reparenting moves the directory under the new parent', async () => {
    await fx.folders.save(folder(FOLDER_1, 'A'));
    await fx.folders.save(folder(FOLDER_2, 'B'));
    await fx.meetings.save(meeting({ folderId: FOLDER_2 }));
    await fx.folders.save(folder(FOLDER_2, 'B', FOLDER_1));
    expect(tree(fx.root)).toEqual(['A/B/2026-09-01 Standup.md', 'folders.json']);
  });

  it('renaming a parent moves its children with it', async () => {
    await fx.folders.save(folder(FOLDER_1, 'P'));
    await fx.folders.save(folder(FOLDER_2, 'C', FOLDER_1));
    await fx.meetings.save(meeting({ folderId: FOLDER_2 }));
    await fx.folders.save(folder(FOLDER_1, 'Q'));
    expect(tree(fx.root)).toEqual(['Q/C/2026-09-01 Standup.md', 'folders.json']);
  });

  it('B7: a case-only rename changes the directory name', async () => {
    await fx.folders.save(folder(FOLDER_1, 'trabajo'));
    await fx.meetings.save(meeting({ folderId: FOLDER_1 }));
    await fx.folders.save(folder(FOLDER_1, 'Trabajo'));
    expect(fs.readdirSync(fx.root).includes('Trabajo')).toBe(true);
    expect(fs.readdirSync(fx.root).includes('trabajo')).toBe(false);
    expect(tree(fx.root)).toEqual(['Trabajo/2026-09-01 Standup.md', 'folders.json']);
  });

  it('B9: rewriting audio paths leaves meetings without a recording alone', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Old'));
    const noAudio = await fx.meetings.save(meeting({ folderId: FOLDER_1 }));
    const elsewhere = await fx.meetings.save(
      meeting({
        id: ID_B,
        title: 'Other',
        folderId: FOLDER_1,
        audioFilePath: 'D:\\elsewhere\\x.wav',
      }),
    );
    await fx.folders.save(folder(FOLDER_1, 'New'));
    const a = await fx.meetings.get(ID_A);
    const b = await fx.meetings.get(ID_B);
    expect(a?.audioFilePath).toBe('');
    expect(b?.audioFilePath).toBe('D:\\elsewhere\\x.wav');
    expect(noAudio.audioFilePath).toBe('');
    expect(elsewhere.audioFilePath).toBe('D:\\elsewhere\\x.wav');
  });

  it('keeps CRLF files CRLF when it rewrites audio paths', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Old'));
    const dir = path.join(fx.root, 'Old');
    const md = path.join(dir, '2026-09-01 Standup.md');
    const text = renderMeetingMarkdown(meeting({ folderId: FOLDER_1 })).replace(/\n/g, '\r\n');
    fs.writeFileSync(md, text);
    fs.writeFileSync(path.join(dir, '2026-09-01 Standup.wav'), 'RIFF');
    await fx.folders.save(folder(FOLDER_1, 'New'));
    const rewritten = fs.readFileSync(path.join(fx.root, 'New', '2026-09-01 Standup.md'), 'utf8');
    expect(rewritten).toContain(
      `audioFilePath: ${path.join(fx.root, 'New', '2026-09-01 Standup.wav')}\r\n`,
    );
    expect(rewritten.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('a directory failure leaves folders.json untouched', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Old'));
    const before = fs.readFileSync(fx.paths.foldersFilePath, 'utf8');
    // A file already sits where the renamed directory would go.
    fs.writeFileSync(path.join(fx.root, 'New'), 'a file, not a directory');
    await expect(fx.folders.save(folder(FOLDER_1, 'New'))).rejects.toThrow();
    expect(fs.readFileSync(fx.paths.foldersFilePath, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(fx.root, 'Old'))).toBe(true);
  });
});

describe('locking', () => {
  it('B6: two instances over one file do not lose writes', async () => {
    const other = new JsonFolderRepository({ foldersFilePath: fx.paths.foldersFilePath });
    const ids = Array.from(
      { length: 12 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    await Promise.all(
      ids.map((id, i) => (i % 2 === 0 ? fx.folders : other).save(folder(id, `F${i}`))),
    );
    expect((await fx.folders.getAll()).map((f) => f.id).sort()).toEqual([...ids].sort());
  });

  it('B6: the meeting repository and the folder repository share the lock', async () => {
    const repo = new MarkdownMeetingRepository({ root: fx.root, folders: fx.folders });
    await Promise.all([
      fx.folders.save(folder(FOLDER_1, 'A')),
      repo.save(meeting({ folderId: FOLDER_1 })),
      fx.folders.save(folder(FOLDER_2, 'B')),
    ]);
    expect((await fx.folders.getAll()).map((f) => f.id).sort()).toEqual(
      [FOLDER_2, FOLDER_1].sort(),
    );
  });
});

describe('reserved and device names', () => {
  it.each([
    ['Meetings', 'Meetings folder'],
    ['Recordings', 'Recordings folder'],
    ['Inbox', 'Inbox folder'],
    ['CON', 'CON_'],
    ['nul', 'nul_'],
  ])('B8c, B10: a folder named %s is created as the directory %s', async (name, directory) => {
    await fx.folders.save(folder(FOLDER_1, name));
    expect(fs.statSync(path.join(fx.root, directory)).isDirectory()).toBe(true);
    await fx.meetings.save(meeting({ folderId: FOLDER_1 }));
    expect(tree(fx.root)).toContain(`${directory}/2026-09-01 Standup.md`);
    // The flat-dump rule does not swallow it: the meeting is a current-layout file.
    expect((await fx.meetings.list()).items).toHaveLength(1);
    expect(await fx.meetings.locate(ID_A)).toEqual([
      { path: path.join(fx.root, directory, '2026-09-01 Standup.md'), legacy: false },
    ]);
  });
});
