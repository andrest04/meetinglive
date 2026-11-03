import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppPaths } from '@vozella/core';
import { ensureDirectoriesExist } from './ensure-directories';
import { JsonSettingsStore } from './json-settings-store';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-settings-'));
  file = path.join(dir, 'app', 'settings.json');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const store = () => new JsonSettingsStore({ settingsFilePath: file });

describe('JsonSettingsStore', () => {
  it('a missing file loads the defaults', async () => {
    const settings = await store().load();
    expect(settings.typeSafeEnabled).toBe(true);
    expect(settings.uiLanguage).toBeNull();
  });

  it('update writes the full file with every property', async () => {
    await store().update({ uiLanguage: 'en' });
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(doc.uiLanguage).toBe('en');
    expect(Object.keys(doc)).toHaveLength(28);
    expect(doc.disabledCalendarIds).toEqual([]);
  });

  it('B17: concurrent updates of different fields both survive', async () => {
    const a = store();
    const b = store();
    await Promise.all([
      a.update({ uiLanguage: 'es' }),
      b.update({ summaryLanguage: 'en' }),
      a.update({ speakerDiarizationEnabled: true }),
      b.update({ navigationPaneLength: 300 }),
    ]);
    expect(await store().load()).toMatchObject({
      uiLanguage: 'es',
      summaryLanguage: 'en',
      speakerDiarizationEnabled: true,
      navigationPaneLength: 300,
    });
  });

  it('B17: unknown keys written by a newer version survive an update', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"futureThing":{"a":1},"uiLanguage":"es"}');
    await store().update({ summaryLanguage: 'en' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      futureThing: { a: 1 },
      uiLanguage: 'es',
      summaryLanguage: 'en',
    });
  });

  it('B5: a damaged file loads defaults and is kept aside, not overwritten', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    expect((await store().load()).uiLanguage).toBeNull();
    expect(fs.readFileSync(`${file}.corrupt`, 'utf8')).toBe('{oops');
    await store().update({ uiLanguage: 'en' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ uiLanguage: 'en' });
  });

  it('a second damaged file does not overwrite the first copy', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.corrupt`, 'first');
    fs.writeFileSync(file, '[1]');
    await store().load();
    expect(fs.readFileSync(`${file}.corrupt`, 'utf8')).toBe('first');
    expect(fs.readFileSync(`${file}.corrupt.1`, 'utf8')).toBe('[1]');
  });

  it('ensures directories before it writes', async () => {
    let called = false;
    const s = new JsonSettingsStore({
      settingsFilePath: file,
      ensureDirectories: () => {
        called = true;
        return Promise.resolve();
      },
    });
    await s.update({ uiLanguage: 'en' });
    expect(called).toBe(true);
  });

  it('reads a file the WinUI app wrote, including string numbers', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      '{\r\n  "selectedSummaryProvider": "ClaudeCode",\r\n  "navigationPaneLength": "310",\r\n  "disabledCalendarIds": ["a", ""]\r\n}',
    );
    expect(await store().load()).toMatchObject({
      selectedSummaryProvider: 'ClaudeCode',
      navigationPaneLength: 310,
      disabledCalendarIds: ['a', ''],
    });
  });
});

describe('ensureDirectoriesExist', () => {
  it('creates the model folders and Inbox, and removes the old Whisper cache', async () => {
    const paths = createAppPaths(
      { appData: path.join(dir, 'app'), library: path.join(dir, 'lib') },
      path,
    );
    fs.mkdirSync(path.join(paths.rootDirectory, 'WhisperModels'), { recursive: true });
    fs.writeFileSync(path.join(paths.rootDirectory, 'WhisperModels', 'x.bin'), 'x');
    fs.mkdirSync(paths.modelsDirectory, { recursive: true });
    fs.writeFileSync(path.join(paths.modelsDirectory, 'ggml-base.bin'), 'x');
    fs.writeFileSync(path.join(paths.modelsDirectory, 'keep.bin'), 'x');

    await ensureDirectoriesExist(paths);

    for (const d of [
      paths.inboxDirectory,
      paths.transcriptionModelsDirectory,
      paths.nemoSpeechDirectory,
      paths.summaryModelsDirectory,
    ]) {
      expect(fs.statSync(d).isDirectory()).toBe(true);
    }
    expect(fs.existsSync(path.join(paths.rootDirectory, 'WhisperModels'))).toBe(false);
    expect(fs.existsSync(path.join(paths.modelsDirectory, 'ggml-base.bin'))).toBe(false);
    expect(fs.existsSync(path.join(paths.modelsDirectory, 'keep.bin'))).toBe(true);
  });

  it('is safe to run twice', async () => {
    const paths = createAppPaths(
      { appData: path.join(dir, 'app'), library: path.join(dir, 'lib') },
      path,
    );
    await ensureDirectoriesExist(paths);
    await expect(ensureDirectoriesExist(paths)).resolves.toBeUndefined();
  });
});
