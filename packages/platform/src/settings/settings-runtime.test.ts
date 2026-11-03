import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CancelSource, SUMMARY_MODELS, type LocalModelStore } from '@vozella/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeCliProbe, FakeHardwareProbe, FakeLocalModelStore } from '../fakes/fake-settings-ports';
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

function runtime(options: { os?: string[]; models?: LocalModelStore } = {}) {
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

  it('offers local models and no account controls', async () => {
    const snapshot = await runtime().runtime.page.load();
    expect(snapshot.capabilities).toEqual({ localModels: true });
    expect(snapshot.providerNotice).toBeNull();
  });

  it('a settings file that still selects Xai loads, shows the notice and keeps every field on a re-save', async () => {
    const { runtime: r, settingsFile } = runtime();
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        selectedSummaryProvider: 'Xai',
        selectedXaiModelId: 'grok-4.3',
        selectedXaiEffort: 'high',
        someFutureField: [1, 2],
      }),
    );
    const snapshot = await r.page.load();
    expect(snapshot.provider).toBe('Xai');
    expect(snapshot.providerNotice).toBe('xai-removed');
    expect(await r.commands.setSummaryProvider('Xai')).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
    expect(await r.commands.setSummaryProvider('Codex')).toMatchObject({ status: 'saved' });
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({
      selectedSummaryProvider: 'Codex',
      selectedXaiModelId: 'grok-4.3',
      selectedXaiEffort: 'high',
      someFutureField: [1, 2],
    });
    expect((await r.page.load()).providerNotice).toBeNull();
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
    // Pinned to the four bytes the test server sends.
    const model = { ...SUMMARY_MODELS[0]!, sizeBytes: 4, sha256: undefined };

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

describe('SettingsRuntime.warmUp', () => {
  it('starts the hardware query once, so the first page load finds it done', async () => {
    let queries = 0;
    const runtimeWith = new SettingsRuntime({
      store: new JsonSettingsStore({ settingsFilePath: path.join(dir, 'settings.json') }),
      appDataDirectory: dir,
      osLanguages: () => ['en-US'],
      relaunch: () => undefined,
      notifyModel: () => undefined,
      hardware: {
        detect: () => {
          queries += 1;
          return Promise.resolve({ totalRamGb: 8, gpuName: null, gpuVramGb: null });
        },
      },
      cli: new FakeCliProbe(new Set()),
    });
    runtimeWith.warmUp();
    expect(queries).toBe(1);
  });

  it('survives a failing hardware query', async () => {
    const runtimeWith = new SettingsRuntime({
      store: new JsonSettingsStore({ settingsFilePath: path.join(dir, 'settings.json') }),
      appDataDirectory: dir,
      osLanguages: () => ['en-US'],
      relaunch: () => undefined,
      notifyModel: () => undefined,
      hardware: { detect: () => Promise.reject(new Error('no powershell')) },
      cli: new FakeCliProbe(new Set()),
    });
    expect(() => {
      runtimeWith.warmUp();
    }).not.toThrow();
    await Promise.resolve();
  });
});
