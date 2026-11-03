import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderMeetingMarkdown } from '@vozella/core';
import {
  migrateLegacyMeetingsJson,
  migrateLibraryLayout,
  migrateUserDataLocation,
  rewriteAudioFilePathLine,
  runStartupMigrations,
} from './migrations';
import {
  FOLDER_1,
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

const put = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const deps = () => ({ paths: fx.paths, meetings: fx.meetings, folders: fx.folders });

describe('user data location', () => {
  it('moves meetings, recordings and folders.json, and rewrites audioFilePath', async () => {
    const wav = put(path.join(fx.paths.legacyRecordingsDirectory, `${ID_A}.wav`), 'RIFF');
    put(
      path.join(fx.paths.legacyMeetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting({ audioFilePath: wav })),
    );
    put(fx.paths.legacyFoldersFilePath, '[]');

    await migrateUserDataLocation(fx.paths);

    expect(tree(fx.root)).toEqual([
      `Meetings/${ID_A}.md`,
      `Recordings/${ID_A}.wav`,
      'folders.json',
    ]);
    const md = fs.readFileSync(path.join(fx.paths.meetingsDirectory, `${ID_A}.md`), 'utf8');
    expect(md).toContain(
      `audioFilePath: ${path.join(fx.paths.recordingsDirectory, `${ID_A}.wav`)}\n`,
    );
    expect(fs.existsSync(fx.paths.legacyMeetingsDirectory)).toBe(false);
    expect(fs.existsSync(fx.paths.legacyRecordingsDirectory)).toBe(false);
    expect(fs.existsSync(fx.paths.legacyFoldersFilePath)).toBe(false);
  });

  it('does not overwrite an existing destination', async () => {
    put(path.join(fx.paths.legacyMeetingsDirectory, 'a.md'), 'legacy');
    put(path.join(fx.paths.meetingsDirectory, 'a.md'), 'current');
    put(fx.paths.legacyFoldersFilePath, 'legacy folders');
    put(fx.paths.foldersFilePath, 'current folders');
    await migrateUserDataLocation(fx.paths);
    expect(fs.readFileSync(path.join(fx.paths.meetingsDirectory, 'a.md'), 'utf8')).toBe('current');
    expect(fs.readFileSync(path.join(fx.paths.legacyMeetingsDirectory, 'a.md'), 'utf8')).toBe(
      'legacy',
    );
    expect(fs.readFileSync(fx.paths.foldersFilePath, 'utf8')).toBe('current folders');
    expect(fs.existsSync(fx.paths.legacyFoldersFilePath)).toBe(true);
  });

  it('is idempotent when already migrated', async () => {
    put(path.join(fx.paths.legacyMeetingsDirectory, 'a.md'), '---\n');
    await migrateUserDataLocation(fx.paths);
    const after = tree(fx.root);
    await migrateUserDataLocation(fx.paths);
    expect(tree(fx.root)).toEqual(after);
  });

  it('B11: a clean install creates no empty Meetings or Recordings folders', async () => {
    await migrateUserDataLocation(fx.paths);
    expect(fs.existsSync(fx.paths.meetingsDirectory)).toBe(false);
    expect(fs.existsSync(fx.paths.recordingsDirectory)).toBe(false);
  });

  it('only moves top-level files', async () => {
    put(path.join(fx.paths.legacyMeetingsDirectory, 'sub', 'deep.md'), 'x');
    await migrateUserDataLocation(fx.paths);
    expect(fs.existsSync(path.join(fx.paths.legacyMeetingsDirectory, 'sub', 'deep.md'))).toBe(true);
  });

  describe('rewriteAudioFilePathLine', () => {
    const legacy = 'C:\\data\\Recordings';
    const current = 'C:\\lib\\Recordings';

    it('rewrites a legacy path and keeps the file name', () => {
      const text = '---\nid: x\naudioFilePath: C:\\data\\Recordings\\abc.wav\n---\n';
      expect(rewriteAudioFilePathLine(text, legacy, current)).toBe(
        `---\nid: x\naudioFilePath: ${path.join(current, 'abc.wav')}\n---\n`,
      );
    });

    it('leaves a path that is already new alone', () => {
      expect(
        rewriteAudioFilePathLine(
          '---\naudioFilePath: C:\\lib\\Recordings\\abc.wav\n---\n',
          legacy,
          current,
        ),
      ).toBeNull();
    });

    it('does not match a sibling folder that shares a prefix', () => {
      expect(
        rewriteAudioFilePathLine(
          '---\naudioFilePath: C:\\data\\RecordingsOld\\a.wav\n---\n',
          legacy,
          current,
        ),
      ).toBeNull();
    });

    it('writes LF even when the file used CRLF', () => {
      const text = '---\r\naudioFilePath: C:\\data\\Recordings\\a.wav\r\n---\r\n';
      expect(rewriteAudioFilePathLine(text, legacy, current)).not.toContain('\r');
    });

    it('ignores an empty value', () => {
      expect(rewriteAudioFilePathLine('---\naudioFilePath: \n---\n', legacy, current)).toBeNull();
    });
  });
});

describe('library layout', () => {
  it('files a legacy md and wav into Inbox with a dated stem, and cleans up', async () => {
    const wav = put(path.join(fx.paths.recordingsDirectory, `${ID_A}.wav`), 'RIFF');
    put(
      path.join(fx.paths.meetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting({ audioFilePath: wav })),
    );
    await migrateLibraryLayout(deps());
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup.md', 'Inbox/2026-09-01 Standup.wav']);
    expect((await fx.meetings.get(ID_A))?.audioFilePath).toBe(
      path.join(fx.root, 'Inbox', '2026-09-01 Standup.wav'),
    );
    expect(fs.existsSync(fx.paths.meetingsDirectory)).toBe(false);
    expect(fs.existsSync(fx.paths.recordingsDirectory)).toBe(false);
  });

  it('restores the wav from Recordings/<guid>.wav when audioFilePath is blank or gone', async () => {
    put(path.join(fx.paths.recordingsDirectory, `${ID_A}.wav`), 'RIFF');
    put(
      path.join(fx.paths.meetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting({ audioFilePath: 'D:\\gone.wav' })),
    );
    await migrateLibraryLayout(deps());
    expect(tree(fx.root)).toContain('Inbox/2026-09-01 Standup.wav');
  });

  it('files a meeting into its folder', async () => {
    await fx.folders.save(folder(FOLDER_1, 'Universidad'));
    put(
      path.join(fx.paths.meetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting({ folderId: FOLDER_1 })),
    );
    await migrateLibraryLayout(deps());
    expect(tree(fx.root)).toEqual(['Universidad/2026-09-01 Standup.md', 'folders.json']);
  });

  it('skips unparsable files and keeps them, cleaning up only empty directories', async () => {
    put(path.join(fx.paths.meetingsDirectory, 'broken.md'), 'not a meeting');
    put(path.join(fx.paths.meetingsDirectory, `${ID_A}.md`), renderMeetingMarkdown(meeting()));
    await migrateLibraryLayout(deps());
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup.md', 'Meetings/broken.md']);
  });

  it('with no markdown it only removes empty legacy directories', async () => {
    fs.mkdirSync(fx.paths.meetingsDirectory, { recursive: true });
    fs.mkdirSync(fx.paths.recordingsDirectory, { recursive: true });
    await migrateLibraryLayout(deps());
    expect(fs.existsSync(fx.paths.meetingsDirectory)).toBe(false);
    expect(fs.existsSync(fx.paths.recordingsDirectory)).toBe(false);
  });

  it('keeps Recordings when orphan recordings remain', async () => {
    put(path.join(fx.paths.recordingsDirectory, 'orphan.wav'), 'RIFF');
    fs.mkdirSync(fx.paths.meetingsDirectory, { recursive: true });
    await migrateLibraryLayout(deps());
    expect(fs.existsSync(path.join(fx.paths.recordingsDirectory, 'orphan.wav'))).toBe(true);
  });

  it('does nothing when there is no Meetings directory', async () => {
    await expect(migrateLibraryLayout(deps())).resolves.toBeUndefined();
  });

  it('B12: a legacy copy never overwrites a newer meeting with the same id', async () => {
    await fx.meetings.save(meeting({ title: 'Standup', notes: 'newer edits' }));
    put(
      path.join(fx.paths.meetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting({ notes: 'stale legacy' })),
    );
    await migrateLibraryLayout(deps());
    expect((await fx.meetings.get(ID_A))?.notes).toBe('newer edits');
    expect(tree(fx.root)).toEqual(['Inbox/2026-09-01 Standup.md']);
  });

  it('B10: a second run after the move finds nothing to do', async () => {
    put(path.join(fx.paths.meetingsDirectory, `${ID_A}.md`), renderMeetingMarkdown(meeting()));
    await migrateLibraryLayout(deps());
    const after = tree(fx.root);
    await migrateLibraryLayout(deps());
    expect(tree(fx.root)).toEqual(after);
  });
});

describe('legacy meetings.json', () => {
  const entry = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: 'Legacy',
    recordedAt: '2026-08-30T10:00:00-05:00',
    audioFilePath: 'C:\\gone\\x.wav',
    transcript: 'hello',
    summary: 'sum',
    actionItems: [{ text: 'Follow up', isDone: true }],
    ...extra,
  });

  it('does nothing when the file is absent', async () => {
    await expect(migrateLegacyMeetingsJson(fx.paths, fx.meetings)).resolves.toBeUndefined();
    expect(tree(fx.root)).toEqual([]);
  });

  it('saves every record and renames the file to .bak', async () => {
    put(fx.paths.meetingsFilePath, JSON.stringify([entry(ID_A), entry(ID_B, { title: 'Two' })]));
    await migrateLegacyMeetingsJson(fx.paths, fx.meetings);
    expect((await fx.meetings.list()).items.map((i) => i.id).sort()).toEqual([ID_A, ID_B]);
    expect(await fx.meetings.get(ID_A)).toMatchObject({
      transcript: 'hello',
      summary: 'sum',
      actionItems: [{ text: 'Follow up', isDone: true }],
      recordedAt: '2026-08-30T10:00:00.0000000-05:00',
    });
    expect(fs.existsSync(fx.paths.meetingsFilePath)).toBe(false);
    expect(fs.existsSync(`${fx.paths.meetingsFilePath}.bak`)).toBe(true);
  });

  it('re-running after a partial failure keeps later edits and migrates the missing ones', async () => {
    await fx.meetings.save(meeting({ id: ID_A, title: 'Legacy', notes: 'edited later' }));
    put(fx.paths.meetingsFilePath, JSON.stringify([entry(ID_A), entry(ID_B)]));
    await migrateLegacyMeetingsJson(fx.paths, fx.meetings);
    expect((await fx.meetings.get(ID_A))?.notes).toBe('edited later');
    expect(await fx.meetings.get(ID_B)).not.toBeNull();
  });

  it('keeps an existing .bak and uses the next free suffix', async () => {
    put(`${fx.paths.meetingsFilePath}.bak`, 'old backup');
    put(`${fx.paths.meetingsFilePath}.bak.1`, 'older');
    put(fx.paths.meetingsFilePath, JSON.stringify([entry(ID_A)]));
    await migrateLegacyMeetingsJson(fx.paths, fx.meetings);
    expect(fs.readFileSync(`${fx.paths.meetingsFilePath}.bak`, 'utf8')).toBe('old backup');
    expect(fs.readFileSync(`${fx.paths.meetingsFilePath}.bak.1`, 'utf8')).toBe('older');
    expect(fs.existsSync(`${fx.paths.meetingsFilePath}.bak.2`)).toBe(true);
  });

  it('a corrupt file throws and the source stays for the next launch', async () => {
    put(fx.paths.meetingsFilePath, '{oops');
    await expect(migrateLegacyMeetingsJson(fx.paths, fx.meetings)).rejects.toThrow();
    expect(fs.existsSync(fx.paths.meetingsFilePath)).toBe(true);
  });

  it('a record missing a required field throws before anything is saved', async () => {
    put(fx.paths.meetingsFilePath, JSON.stringify([entry(ID_A), { id: ID_B }]));
    await expect(migrateLegacyMeetingsJson(fx.paths, fx.meetings)).rejects.toThrow();
    expect(tree(fx.root)).toEqual([]);
    expect(fs.existsSync(fx.paths.meetingsFilePath)).toBe(true);
  });
});

describe('runStartupMigrations', () => {
  it('runs all three in order on a mixed legacy install', async () => {
    put(
      path.join(fx.paths.legacyMeetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting()),
    );
    put(
      fx.paths.meetingsFilePath,
      JSON.stringify([
        { id: ID_B, title: 'Json', recordedAt: '2026-08-30T10:00:00Z', audioFilePath: '' },
      ]),
    );
    expect(await runStartupMigrations(deps())).toEqual({ error: null });
    expect((await fx.meetings.list()).items.map((i) => i.id).sort()).toEqual([ID_A, ID_B]);
  });

  it('the first error is returned and later migrations are skipped', async () => {
    put(fx.paths.meetingsFilePath, '{oops');
    put(
      path.join(fx.paths.legacyMeetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting()),
    );
    const result = await runStartupMigrations(deps());
    expect(result.error).not.toBeNull();
    // The first two steps ran before the third failed; the file stays for the next launch.
    expect(fs.existsSync(fx.paths.meetingsFilePath)).toBe(true);
  });

  it('is idempotent', async () => {
    put(
      path.join(fx.paths.legacyMeetingsDirectory, `${ID_A}.md`),
      renderMeetingMarkdown(meeting()),
    );
    await runStartupMigrations(deps());
    const after = tree(fx.root);
    expect(await runStartupMigrations(deps())).toEqual({ error: null });
    expect(tree(fx.root)).toEqual(after);
  });
});
