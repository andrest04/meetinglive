import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderMeetingMarkdown } from '@vozella/core';
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

const write = (rel: string, text: string): string => {
  const full = path.join(fx.root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
};

describe('save and read', () => {
  it('writes only inside the injected root', async () => {
    await fx.meetings.save(meeting());
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup.md']);
    expect(fs.readdirSync(fx.dir).sort()).toEqual(['app', 'library']);
  });

  it('round-trips a meeting and sets sourcePath', async () => {
    const saved = await fx.meetings.save(
      meeting({ summary: '## Decisions\nShip it', notes: 'n', folderId: null }),
    );
    expect(saved.sourcePath).toBe(path.join(fx.root, 'Inbox', '2026-09-01 Standup.md'));
    expect(await fx.meetings.get(ID_A)).toEqual(saved);
  });

  it('files a meeting in its folder directory, and an unknown folder in Inbox', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    await fx.folders.save(folder(FOLDER_2, 'Calculo', FOLDER_1));
    await fx.meetings.save(meeting({ folderId: FOLDER_2 }));
    await fx.meetings.save(
      meeting({ id: ID_B, title: 'Lost', folderId: 'deadbeef-0000-0000-0000-000000000000' }),
    );
    expect(tree(fx.root)).toEqual([
      'Inbox/2026-09-01 Lost.md',
      'Universidad/Calculo/2026-09-01 Standup.md',
      'folders.json',
    ]);
  });

  it('adds a numeric suffix for a different meeting with the same stem', async () => {
    await fx.meetings.save(meeting());
    await fx.meetings.save(meeting({ id: ID_B }));
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup 2.md', 'Inbox/2026-09-01 Standup.md']);
  });

  it('saving the same meeting again reuses its file', async () => {
    await fx.meetings.save(meeting());
    await fx.meetings.save(meeting({ summary: 'changed' }));
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup.md']);
    expect((await fx.meetings.get(ID_A))?.summary).toBe('changed');
  });

  it('get returns null for an unknown id', async () => {
    expect(await fx.meetings.get(ID_B)).toBeNull();
  });

  it('writes LF without a BOM', async () => {
    const saved = await fx.meetings.save(meeting());
    const bytes = fs.readFileSync(saved.sourcePath ?? '');
    expect(bytes[0]).toBe(0x2d);
    expect(bytes.includes(0x0d)).toBe(false);
  });
});

describe('moving and renaming', () => {
  it('changing the folder moves the markdown and the wav together and updates audioFilePath', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    const first = await fx.meetings.save(meeting());
    const wav = first.sourcePath?.replace(/\.md$/, '.wav') ?? '';
    fs.writeFileSync(wav, 'RIFF');
    const withAudio = await fx.meetings.save({ ...first, audioFilePath: wav });
    expect(withAudio.audioFilePath).toBe(wav);

    const moved = await fx.meetings.save({ ...withAudio, folderId: FOLDER_1 });
    expect(tree(fx.root)).toEqual([
      'Universidad/2026-09-01 Standup.md',
      'Universidad/2026-09-01 Standup.wav',
      'folders.json',
    ]);
    expect(moved.audioFilePath).toBe(path.join(fx.root, 'Universidad', '2026-09-01 Standup.wav'));
    expect(moved.folderId).toBe(FOLDER_1);
    expect((await fx.meetings.get(ID_A))?.audioFilePath).toBe(moved.audioFilePath);
  });

  it('a new title renames the files', async () => {
    const first = await fx.meetings.save(meeting());
    await fx.meetings.save({ ...first, title: 'Retro' });
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Retro.md']);
  });

  it('B2: a recording already sitting at the stem does not force a " 2" suffix', async () => {
    // The recorder creates the wav first, then the first save writes the markdown.
    const wav = path.join(fx.root, 'Inbox', '2026-09-01 Standup.wav');
    fs.mkdirSync(path.dirname(wav), { recursive: true });
    fs.writeFileSync(wav, 'RIFF');
    const saved = await fx.meetings.save(meeting({ audioFilePath: wav }));
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup.md', 'Inbox/2026-09-01 Standup.wav']);
    expect(saved.audioFilePath).toBe(wav);
  });

  it('B2: a recording that belongs to someone else still forces a new stem', async () => {
    const wav = path.join(fx.root, 'Inbox', '2026-09-01 Standup.wav');
    fs.mkdirSync(path.dirname(wav), { recursive: true });
    fs.writeFileSync(wav, 'RIFF');
    await fx.meetings.save(meeting());
    expect(tree(fx.root)).toEqual([
      'Inbox/2026-09-01 Standup 2.md',
      'Inbox/2026-09-01 Standup.wav',
    ]);
  });

  it('moves a recording from elsewhere in and replaces a file at the destination', async () => {
    const source = path.join(fx.dir, 'elsewhere.wav');
    fs.writeFileSync(source, 'NEW');
    const saved = await fx.meetings.save(meeting({ audioFilePath: source }));
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(saved.audioFilePath, 'utf8')).toBe('NEW');
  });

  it('a failed wav move leaves the old markdown and the old files untouched', async () => {
    const failing = createLibraryFixture({
      rename: () => Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' })),
    });
    try {
      await failing.folders.save(folder(FOLDER_1, 'U'));
      const first = await failing.meetings.save(meeting());
      const wav = first.sourcePath?.replace(/\.md$/, '.wav') ?? '';
      fs.writeFileSync(wav, 'RIFF');
      await expect(
        failing.meetings.save({ ...first, audioFilePath: wav, folderId: FOLDER_1 }),
      ).rejects.toThrow('EBUSY');
      expect(tree(failing.root)).toEqual([
        'Inbox/2026-09-01 Standup.md',
        'Inbox/2026-09-01 Standup.wav',
        'folders.json',
      ]);
    } finally {
      failing.cleanup();
    }
  });
});

describe('delete', () => {
  it('removes the markdown and the wav', async () => {
    const first = await fx.meetings.save(meeting());
    const wav = first.sourcePath?.replace(/\.md$/, '.wav') ?? '';
    fs.writeFileSync(wav, 'RIFF');
    await fx.meetings.save({ ...first, audioFilePath: wav });
    await fx.meetings.delete(ID_A);
    expect(tree(fx.root)).toEqual([]);
  });

  it('is a no-op for a meeting that is already gone', async () => {
    await expect(fx.meetings.delete(ID_A)).resolves.toBeUndefined();
  });

  it('still removes the markdown when the wav is missing', async () => {
    await fx.meetings.save(meeting({ audioFilePath: path.join(fx.root, 'Inbox', 'gone.wav') }));
    await fx.meetings.delete(ID_A);
    expect(tree(fx.root)).toEqual([]);
  });

  it('a locked wav throws and the meeting stays listed so it can be retried', async () => {
    let locked = true;
    const f = createLibraryFixture({
      unlink: (p) =>
        locked && p.endsWith('.wav')
          ? Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))
          : fs.promises.unlink(p),
    });
    try {
      const first = await f.meetings.save(meeting());
      const wav = first.sourcePath?.replace(/\.md$/, '.wav') ?? '';
      fs.writeFileSync(wav, 'RIFF');
      await f.meetings.save({ ...first, audioFilePath: wav });
      await expect(f.meetings.delete(ID_A)).rejects.toThrow('EBUSY');
      expect((await f.meetings.list()).items.map((i) => i.id)).toEqual([ID_A]);
      locked = false;
      await f.meetings.delete(ID_A);
      expect(tree(f.root)).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  it('does not rewrite sibling meetings', async () => {
    const a = await fx.meetings.save(meeting());
    const b = await fx.meetings.save(meeting({ id: ID_B, title: 'Other' }));
    const before = fs.statSync(b.sourcePath ?? '').mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    await fx.meetings.delete(ID_A);
    expect(fs.statSync(b.sourcePath ?? '').mtimeMs).toBe(before);
    expect(fs.existsSync(a.sourcePath ?? '')).toBe(false);
  });

  it('B25: a recording outside the library is left in place', async () => {
    const outside = path.join(fx.dir, 'precious.wav');
    fs.writeFileSync(outside, 'RIFF');
    const saved = await fx.meetings.save(meeting());
    // Hand-edit the stored path to point outside the library.
    fs.writeFileSync(
      saved.sourcePath ?? '',
      renderMeetingMarkdown({ ...saved, audioFilePath: outside }),
    );
    await fx.meetings.delete(ID_A);
    expect(fs.existsSync(outside)).toBe(true);
    expect(tree(fx.root)).toEqual([]);
  });
});

describe('list', () => {
  it('walks every depth and returns the light items', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    await fx.meetings.save(meeting({ folderId: FOLDER_1, summary: '# T\nBody' }));
    await fx.meetings.save(meeting({ id: ID_B, title: 'Second' }));
    const { items, skipped } = await fx.meetings.list();
    expect(items.map((i) => i.id).sort()).toEqual([ID_A, ID_B]);
    expect(items.find((i) => i.id === ID_A)).toMatchObject({ folderId: FOLDER_1, snippet: 'Body' });
    expect(skipped).toEqual([]);
  });

  it('an empty or missing root lists nothing', async () => {
    fs.rmSync(fx.root, { recursive: true });
    expect(await fx.meetings.list()).toEqual({ items: [], skipped: [] });
  });

  it('a corrupt file does not hide the readable meetings, and is reported', async () => {
    await fx.meetings.save(meeting());
    write('Inbox/broken.md', 'not a meeting');
    write(
      'Inbox/bad-jev.md',
      `---\nid: ${ID_B}\nrecordedAt: 2026-09-01T12:00:00Z\n---\n\n## Jev\n\n{oops\n`,
    );
    const { items, skipped } = await fx.meetings.list();
    expect(items.map((i) => i.id)).toEqual([ID_A]);
    expect(skipped.map((s) => path.basename(s.path)).sort()).toEqual(['bad-jev.md', 'broken.md']);
  });

  it('picks up files changed outside the app', async () => {
    const saved = await fx.meetings.save(meeting());
    expect((await fx.meetings.list()).items[0]?.title).toBe('Standup');
    await new Promise((r) => setTimeout(r, 15));
    fs.writeFileSync(
      saved.sourcePath ?? '',
      renderMeetingMarkdown({ ...saved, title: 'Edited outside' }),
    );
    expect((await fx.meetings.list()).items[0]?.title).toBe('Edited outside');
    fs.rmSync(saved.sourcePath ?? '');
    expect((await fx.meetings.list()).items).toEqual([]);
  });

  it('ignores temp files from interrupted writes', async () => {
    await fx.meetings.save(meeting());
    write('Inbox/.x.md.abc123.tmp', '---');
    expect((await fx.meetings.list()).skipped).toEqual([]);
  });
});

describe('duplicate ids', () => {
  const text = (title: string) => renderMeetingMarkdown(meeting({ title }));

  it('prefers a Library file over a legacy flat dump', async () => {
    write(`Meetings/${ID_A}.md`, text('Legacy'));
    write('Inbox/current.md', text('Current'));
    expect((await fx.meetings.list()).items).toHaveLength(1);
    expect((await fx.meetings.list()).items[0]?.title).toBe('Current');
    expect((await fx.meetings.get(ID_A))?.title).toBe('Current');
  });

  it('uses a legacy copy when it is the only one', async () => {
    write(`Recordings/${ID_A}.md`, text('Only legacy'));
    expect((await fx.meetings.get(ID_A))?.title).toBe('Only legacy');
  });

  it('B20: between two current files the newest wins, deterministically', async () => {
    const older = write('Inbox/older.md', text('Older'));
    const newer = write('Docs/newer.md', text('Newer'));
    fs.utimesSync(older, new Date('2026-01-01'), new Date('2026-01-01'));
    fs.utimesSync(newer, new Date('2026-06-01'), new Date('2026-06-01'));
    for (let i = 0; i < 3; i += 1) {
      expect((await fx.meetings.get(ID_A))?.title).toBe('Newer');
    }
  });

  it('saving updates the winner and removes nothing else', async () => {
    write(`Meetings/${ID_A}.md`, text('Legacy'));
    await fx.meetings.save(meeting({ title: 'Fresh' }));
    // The legacy file was the existing markdown, so it moves into the library layout.
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Fresh.md']);
  });
});

describe('robustness', () => {
  it('B5: a damaged folders.json does not stop meetings from being saved', async () => {
    fs.writeFileSync(fx.paths.foldersFilePath, '{oops');
    const saved = await fx.meetings.save(meeting({ folderId: FOLDER_1 }));
    expect(saved.sourcePath).toBe(path.join(fx.root, 'Inbox', '2026-09-01 Standup.md'));
    expect(saved.folderId).toBe(FOLDER_1);
    expect(fs.readFileSync(fx.paths.foldersFilePath, 'utf8')).toBe('{oops');
  });

  it('concurrent saves of one meeting end with one file holding the last write', async () => {
    const first = await fx.meetings.save(meeting());
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => fx.meetings.save({ ...first, notes: `note ${i}` })),
    );
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup.md']);
    expect((await fx.meetings.get(ID_A))?.notes).toBe('note 7');
  });

  it('concurrent saves of different meetings with one title get distinct stems', async () => {
    const ids = ['3', '4', '5', '6'].map(
      (n) =>
        n.repeat(8) +
        '-' +
        n.repeat(4) +
        '-' +
        n.repeat(4) +
        '-' +
        n.repeat(4) +
        '-' +
        n.repeat(12),
    );
    await Promise.all(ids.map((id) => fx.meetings.save(meeting({ id }))));
    expect(tree(fx.root)).toEqual([
      'Inbox/2026-09-01 Standup 2.md',
      'Inbox/2026-09-01 Standup 3.md',
      'Inbox/2026-09-01 Standup 4.md',
      'Inbox/2026-09-01 Standup.md',
    ]);
  });

  it('a file with a title that sanitizes badly still lands in a legal path', async () => {
    const saved = await fx.meetings.save(meeting({ title: 'Q3: plan/review?' }));
    expect(path.basename(saved.sourcePath ?? '')).toBe('2026-09-01 Q3 plan review.md');
  });

  it('a title holding a newline and --- survives (B3)', async () => {
    await fx.meetings.save(meeting({ title: 'one\n---\ntwo' }));
    expect((await fx.meetings.list()).items[0]?.title).toBe('one --- two');
  });
});

describe('the directory tree is a write-only mirror', () => {
  it('the folder of a meeting is its frontmatter folderId, not the directory it sits in', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    const saved = await fx.meetings.save(meeting({ folderId: FOLDER_1 }));
    // The user drags the file to another directory in the file manager.
    const elsewhere = path.join(fx.root, 'Dragged', 'moved.md');
    fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
    fs.renameSync(saved.sourcePath ?? '', elsewhere);
    const item = (await fx.meetings.list()).items[0];
    expect(item?.folderId).toBe(FOLDER_1);
    expect((await fx.meetings.get(ID_A))?.sourcePath).toBe(elsewhere);
  });
});
