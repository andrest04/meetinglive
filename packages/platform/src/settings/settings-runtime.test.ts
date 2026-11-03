import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CancelSource, SUMMARY_MODELS, type LocalModelStore } from '@vozella/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeCliProbe,
  FakeHardwareProbe,
  FakeLocalModelStore,
  FakeXaiAccount,
} from '../fakes/fake-settings-ports';
import { JsonSettingsStore } from '../library/json-settings-store';
import { FileLocalModelStore } from './file-local-model-store';
import { SettingsRuntime } from './settings-runtime';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-settings-runtime-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runtime(options: { os?: string[]; xai?: FakeXaiAccount; models?: LocalModelStore } = {}) {
  const settingsFile = path.join(dir, 'settings.json');
  const runtimeNotices: string[] = [];
  const holder: { runtime?: SettingsRuntime } = {};
  const store = new JsonSettingsStore({
    settingsFilePath: settingsFile,
    onDamaged: (info) => {
      runtimeNotices.push(info.keptAs);
      holder.runtime?.notices.add({ kind: 'settings-recovered', keptAs: info.keptAs });
    },
  });
  const relaunches: string[] = [];
  const created = new SettingsRuntime({
    store,
    appDataDirectory: dir,
    osLanguages: () => options.os ?? ['en-US'],
    relaunch: () => {
      relaunches.push('relaunch');
    },
    notifyModel: () => undefined,
    hardware: new FakeHardwareProbe({ totalRamGb: 16, gpuName: 'GPU', gpuVramGb: 8 }),
    cli: new FakeCliProbe(new Set(['claude'])),
    ...(options.xai ? { xaiAccount: options.xai } : {}),
    ...(options.models ? { modelStore: options.models } : {}),
  });
  holder.runtime = created;
  return { runtime: created, store, settingsFile, relaunches, runtimeNotices };
}

describe('SettingsRuntime over the real settings file', () => {
  it('opening the page writes nothing', async () => {
    const { runtime: r, settingsFile } = runtime();
    const snapshot = await r.page.load();
    expect(snapshot.provider).toBe('Local');
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it('commands save one field each and keep the others and unknown keys', async () => {
    const { runtime: r, settingsFile } = runtime();
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({ somethingNew: { a: 1 }, typeSafeEnabled: false }),
    );
    await r.commands.setSummaryProvider('Codex');
    await r.commands.setMeetingLanguage('summary', 'en');
    await r.commands.setUiLanguage('es');
    const doc = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
    expect(doc).toMatchObject({
      selectedSummaryProvider: 'Codex',
      summaryLanguage: 'en',
      uiLanguage: 'es',
      typeSafeEnabled: false,
      somethingNew: { a: 1 },
    });
  });

  it('B1: parallel commands from different sections all land in the file', async () => {
    const { runtime: r, store } = runtime();
    await Promise.all([
      r.commands.setSummaryProvider('ClaudeCode'),
      r.commands.setCliOption({ provider: 'claude', field: 'model', value: 'opus' }),
      r.commands.setCliOption({ provider: 'claude', field: 'effort', value: 'max' }),
      r.commands.setMeetingLanguage('transcription', 'pt'),
      r.commands.setUiLanguage('es'),
    ]);
    expect(await store.load()).toMatchObject({
      selectedSummaryProvider: 'ClaudeCode',
      selectedClaudeModelId: 'opus',
      selectedClaudeEffort: 'max',
      transcriptionLanguage: 'pt',
      uiLanguage: 'es',
    });
  });

  it('B4: a damaged file gives defaults and a notice naming where it was kept', async () => {
    const { runtime: r, settingsFile } = runtime();
    fs.writeFileSync(settingsFile, '{ broken');
    const snapshot = await r.page.load();
    expect(snapshot.provider).toBe('Local');
    expect(snapshot.notices).toHaveLength(1);
    expect(snapshot.notices[0]).toMatchObject({
      kind: 'settings-recovered',
      keptAs: `${settingsFile}.corrupt`,
    });
    r.notices.dismiss('settings-recovered');
    expect((await r.page.load()).notices).toEqual([]);
  });

  it('the extension points are off until a module registers behind them', async () => {
    const without = await runtime().runtime.page.load();
    expect(without.capabilities).toEqual({
      xaiAccount: false,
      xaiSignIn: false,
      localModels: true,
    });
    expect(without.xai.available).toBe(false);
    const xai = new FakeXaiAccount();
    const withXai = await runtime({ xai }).runtime.page.load();
    expect(withXai.capabilities).toMatchObject({ xaiAccount: true, xaiSignIn: false });
    expect(withXai.xai).toMatchObject({ available: true, signedIn: false });
  });

  it('item 102: no secret reaches settings.json', async () => {
    const xai = new FakeXaiAccount();
    const { runtime: r, settingsFile } = runtime({ xai });
    await r.commands.setSummaryProvider('Xai');
    await r.xai.saveApiKey('xai-super-secret-key');
    await r.xai.refresh();
    const text = fs.readFileSync(settingsFile, 'utf8');
    expect(text).not.toContain('xai-super-secret-key');
    expect(text).not.toMatch(/apikey|api_key|token/i);
  });

  it('selecting xAI and refreshing persists the resolved model', async () => {
    const xai = new FakeXaiAccount();
    xai.kind = 'ApiKey';
    const { runtime: r, store } = runtime({ xai });
    await r.commands.setSummaryProvider('Xai');
    const view = await r.xai.refresh();
    expect(view).toMatchObject({ selectedModelId: 'grok-4.6', modelsLoaded: true });
    expect((await store.load()).selectedXaiModelId).toBe('grok-4.6');
  });

  it('restart goes through the exit gate', async () => {
    const { runtime: r, relaunches } = runtime();
    const off = r.exitGates.register(() => false);
    expect(await r.restart.restart()).toEqual({ status: 'refused' });
    off();
    expect(await r.restart.restart()).toEqual({ status: 'restarting' });
    expect(relaunches).toEqual(['relaunch']);
  });

  it('detects the CLI from the probe it was given', async () => {
    const { runtime: r } = runtime();
    expect(await r.page.detectCli('ClaudeCode')).toBe('detected');
    expect(await r.page.detectCli('Codex')).toBe('missing');
  });
});

// One contract, two adapters: the fake the e2e build uses and the files the app uses.
describe('LocalModelStore contract', () => {
  let server: http.Server;
  let url = '';
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-length': 4 });
      res.end('GGUF');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/m`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  const adapters: [string, () => LocalModelStore][] = [
    ['FakeLocalModelStore', () => new FakeLocalModelStore()],
    [
      'FileLocalModelStore',
      () =>
        new FileLocalModelStore({ directory: path.join(dir, 'SummaryModels'), urlFor: () => url }),
    ],
  ];

  describe.each(adapters)('%s', (_name, make) => {
    const model = SUMMARY_MODELS[0]!;

    it('not downloaded, then downloaded with progress ending at 100, then deleted', async () => {
      const store = make();
      expect(await store.isDownloaded(model)).toBe(false);
      const percents: number[] = [];
      await store.download(model, (p) => percents.push(p), new CancelSource().signal);
      expect(percents.at(-1)).toBe(100);
      expect(await store.isDownloaded(model)).toBe(true);
      await store.delete(model);
      expect(await store.isDownloaded(model)).toBe(false);
    });

    it('a cancelled download rejects and leaves the model absent', async () => {
      const store = make();
      const cancel = new CancelSource();
      cancel.cancel();
      await expect(store.download(model, () => undefined, cancel.signal)).rejects.toThrow();
      expect(await store.isDownloaded(model)).toBe(false);
    });
  });
});
