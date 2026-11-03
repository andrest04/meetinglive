import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MeetingBusyRegistry, renderMeetingMarkdown } from '@vozella/core';
import type { DataRoots, RunMode } from '../data-root/resolve-data-root';
import { FakeClock } from '../fakes/fake-clock';
import { LibraryRuntime, type LibraryChangeReason } from './library-runtime';
import { ID_A, meeting } from './library-test-kit';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-runtime-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const noop = (): void => undefined;
const silent = { debug: noop, info: noop, warn: noop, error: noop };

function make(
  options: {
    mode?: RunMode;
    source?: DataRoots['source'];
    picked?: string | null;
    open?: string;
    root?: string;
  } = {},
) {
  const root = options.root ?? dir;
  const roots: DataRoots = {
    appData: path.join(root, 'app'),
    meetings: path.join(root, 'meetings'),
    source: options.source ?? 'env',
  };
  const changes: LibraryChangeReason[] = [];
  const opened: string[] = [];
  const runtime = new LibraryRuntime({
    mode: options.mode ?? 'test',
    roots,
    guard: {
      localAppData: path.join(dir, 'fake-localappdata'),
      documents: path.join(dir, 'fake-documents'),
      tempDir: os.tmpdir(),
    },
    logger: silent,
    clock: new FakeClock('2026-09-05T15:00:00Z'),
    newId: () => crypto.randomUUID(),
    busy: new MeetingBusyRegistry(),
    openPath: (p) => {
      opened.push(p);
      return Promise.resolve(options.open ?? '');
    },
    pickFolder: () => Promise.resolve(options.picked ?? null),
    version: '1.2.3.4',
    onChanged: (reason) => changes.push(reason),
  });
  return { runtime, roots, changes, opened };
}

describe('start', () => {
  it('builds the default library, ensures directories and works', async () => {
    const { runtime, roots } = make();
    await runtime.start();
    expect(fs.existsSync(path.join(roots.meetings, 'Inbox'))).toBe(true);
    expect(fs.existsSync(path.join(roots.appData, 'NemoSpeech'))).toBe(true);
    const created = await runtime.service.createFolder({ name: 'Trabajo', parentId: null });
    expect(created.ok).toBe(true);
    expect(fs.existsSync(path.join(roots.meetings, 'Trabajo'))).toBe(true);
    expect(runtime.location()).toMatchObject({
      libraryRoot: roots.meetings,
      appDataRoot: roots.appData,
      source: 'env',
      sharesMeetingLive: false,
      version: '1.2.3.4',
      startupError: null,
    });
  });

  it('runs the startup migrations and reports the first failure', async () => {
    const { runtime, roots } = make();
    fs.mkdirSync(roots.appData, { recursive: true });
    fs.writeFileSync(path.join(roots.appData, 'meetings.json'), '{oops');
    await runtime.start();
    expect(runtime.location().startupError).not.toBeNull();
    expect(fs.existsSync(path.join(roots.appData, 'meetings.json'))).toBe(true);
  });

  it('migrates a first-generation meeting from the app data root', async () => {
    const { runtime, roots } = make();
    fs.mkdirSync(path.join(roots.appData, 'Meetings'), { recursive: true });
    fs.writeFileSync(
      path.join(roots.appData, 'Meetings', `${ID_A}.md`),
      renderMeetingMarkdown(meeting()),
    );
    await runtime.start();
    expect((await runtime.service.load()).ok).toBe(true);
    expect((await runtime.meetings.list()).items.map((i) => i.id)).toEqual([ID_A]);
    expect(fs.existsSync(path.join(roots.meetings, 'Inbox', '2026-09-01 Standup.md'))).toBe(true);
  });

  it('throws if used before start', () => {
    expect(() => make().runtime.service).toThrow(/not been started/);
  });
});

describe('choosing a folder', () => {
  const meetingLive = () => path.join(dir, 'picked', 'MeetingLive');

  it.each<RunMode>(['test', 'development'])(
    '%s mode refuses a MeetingLive folder',
    async (mode) => {
      const { runtime, roots } = make({ mode, source: 'dev-fallback' });
      await runtime.start();
      const result = await runtime.setLocation(meetingLive());
      expect(result).toMatchObject({ status: 'refused', reason: 'forbidden' });
      expect(runtime.location().libraryRoot).toBe(roots.meetings);
      expect(fs.existsSync(meetingLive())).toBe(false);
    },
  );

  it('production with an environment override still refuses it', async () => {
    const { runtime } = make({ mode: 'production', source: 'env' });
    await runtime.start();
    expect(await runtime.setLocation(meetingLive())).toMatchObject({
      status: 'refused',
      reason: 'forbidden',
    });
  });

  it('production without an override accepts a MeetingLive folder', async () => {
    const { runtime, changes } = make({ mode: 'production', source: 'default' });
    await runtime.start();
    const result = await runtime.setLocation(meetingLive());
    expect(result.status).toBe('changed');
    expect(runtime.location()).toMatchObject({
      libraryRoot: meetingLive(),
      source: 'chosen',
      sharesMeetingLive: true,
    });
    expect(changes).toEqual(['location']);
    expect(fs.existsSync(path.join(meetingLive(), 'Inbox'))).toBe(true);
  });

  it('any other folder is accepted in every mode and is used for new data', async () => {
    const target = path.join(dir, 'elsewhere');
    const { runtime } = make({ mode: 'test' });
    await runtime.start();
    expect((await runtime.setLocation(target)).status).toBe('changed');
    await runtime.service.createFolder({ name: 'X', parentId: null });
    expect(fs.existsSync(path.join(target, 'X'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'folders.json'))).toBe(true);
  });

  it('refuses relative paths and files', async () => {
    const { runtime } = make();
    await runtime.start();
    expect(await runtime.setLocation('relative/path')).toMatchObject({ reason: 'not-absolute' });
    const file = path.join(dir, 'a-file');
    fs.writeFileSync(file, 'x');
    expect(await runtime.setLocation(file)).toMatchObject({
      status: 'refused',
      reason: 'unusable',
    });
  });

  it('remembers the choice across launches and reset returns to the default', async () => {
    const target = path.join(dir, 'elsewhere');
    const first = make();
    await first.runtime.start();
    await first.runtime.setLocation(target);

    const second = make();
    await second.runtime.start();
    expect(second.runtime.location().libraryRoot).toBe(target);

    const reset = await second.runtime.setLocation(null);
    expect(reset).toMatchObject({
      status: 'changed',
      location: { libraryRoot: second.roots.meetings, source: 'env' },
    });
    const third = make();
    await third.runtime.start();
    expect(third.runtime.location().libraryRoot).toBe(third.roots.meetings);
  });

  it('a saved MeetingLive choice is ignored when the guard applies', async () => {
    const prod = make({ mode: 'production', source: 'default' });
    await prod.runtime.start();
    await prod.runtime.setLocation(meetingLive());

    const dev = make({ mode: 'development', source: 'dev-fallback' });
    await dev.runtime.start();
    expect(dev.runtime.location().libraryRoot).toBe(dev.roots.meetings);
    expect(fs.existsSync(path.join(meetingLive(), 'folders.json'))).toBe(false);
  });

  it('a damaged choice file falls back to the default', async () => {
    const { runtime, roots } = make();
    fs.mkdirSync(roots.appData, { recursive: true });
    fs.writeFileSync(path.join(roots.appData, 'library-location.json'), '{oops');
    await runtime.start();
    expect(runtime.location().libraryRoot).toBe(roots.meetings);
  });

  it('chooseLocation uses the picker; a cancel changes nothing', async () => {
    const cancelled = make({ picked: null });
    await cancelled.runtime.start();
    expect(await cancelled.runtime.chooseLocation()).toEqual({ status: 'cancelled' });
    expect(cancelled.changes).toEqual([]);

    const target = path.join(dir, 'picked-folder');
    const picked = make({ picked: target });
    await picked.runtime.start();
    expect((await picked.runtime.chooseLocation()).status).toBe('changed');
    expect(picked.runtime.location().libraryRoot).toBe(target);
  });
});

describe('openFolder', () => {
  it('ensures the directories and opens the Library root', async () => {
    const { runtime, opened, roots } = make();
    await runtime.start();
    fs.rmSync(path.join(roots.meetings, 'Inbox'), { recursive: true });
    expect(await runtime.openFolder()).toEqual({ opened: true, error: null });
    expect(opened).toEqual([roots.meetings]);
    expect(fs.existsSync(path.join(roots.meetings, 'Inbox'))).toBe(true);
  });

  it('reports the shell error', async () => {
    const { runtime } = make({ open: 'no handler' });
    await runtime.start();
    expect(await runtime.openFolder()).toEqual({ opened: false, error: 'no handler' });
  });
});

describe('settings', () => {
  it('lives in the app data root and survives a library change', async () => {
    const { runtime, roots } = make();
    await runtime.start();
    await runtime.settings.update({ uiLanguage: 'en' });
    await runtime.setLocation(path.join(dir, 'elsewhere'));
    expect((await runtime.loadSettings()).uiLanguage).toBe('en');
    expect(fs.existsSync(path.join(roots.appData, 'settings.json'))).toBe(true);
  });
});
