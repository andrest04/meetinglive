import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsPageSchema, type EventChannel, type ModelEventDto } from '@vozella/contracts';
import { readSettings, type Logger } from '@vozella/core';
import {
  FakeCliProbe,
  FakeHardwareProbe,
  FakeLocalModelStore,
  JsonSettingsStore,
  SettingsRuntime,
} from '@vozella/platform';
import { LocaleState, resolveStartupLanguage } from '../i18n/locale-state';
import { mainCatalogs } from '../i18n/main-catalogs';
import type { IpcEventLike } from '../security/trusted-origin';
import type { IpcMainLike } from './ipc-server';
import { modelEventBridge, registerSettingsHandlers } from './settings-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-settings-handlers-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Options {
  os?: string[];
  models?: FakeLocalModelStore;
  relaunch?: () => void;
}

async function setup(options: Options = {}) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const events: { name: string; payload: unknown }[] = [];
  const broadcast = (channel: EventChannel, payload: unknown) => {
    events.push({ name: channel.name, payload });
  };
  const osLanguages = options.os ?? ['en-US'];
  const settingsFile = path.join(dir, 'settings.json');
  const store = new JsonSettingsStore({ settingsFilePath: settingsFile });
  const runtime = new SettingsRuntime({
    store,
    appDataDirectory: dir,
    osLanguages: () => osLanguages,
    relaunch: options.relaunch ?? (() => undefined),
    notifyModel: modelEventBridge(broadcast),
    hardware: new FakeHardwareProbe({ totalRamGb: 16, gpuName: null, gpuVramGb: null }),
    cli: new FakeCliProbe(new Set(['codex'])),
    modelStore: options.models ?? new FakeLocalModelStore(),
  });
  const locale = new LocaleState(
    await resolveStartupLanguage(() => store.load(), osLanguages),
    mainCatalogs,
  );
  registerSettingsHandlers({
    server: { ipc, isTrusted: () => true, logger: logger() },
    runtime,
    locale,
    broadcast,
  });
  const call = async (name: string, input: unknown = {}) =>
    (await handlers.get(name)?.(event as never, input)) as {
      ok: boolean;
      value?: Record<string, unknown>;
      error?: { code: string };
    };
  return { call, events, runtime, locale, settingsFile, store, registered: [...handlers.keys()] };
}

describe('settings handlers', () => {
  it('serves the page in a shape that satisfies the contract', async () => {
    const t = await setup();
    const page = await t.call('settings.getPage');
    expect(page.ok).toBe(true);
    expect(settingsPageSchema.safeParse(page.value).success).toBe(true);
    expect(page.value).toMatchObject({
      provider: 'Local',
      uiLanguage: 'en-US',
      capabilities: { localModels: true },
      providerNotice: null,
    });
    expect(fs.existsSync(t.settingsFile)).toBe(false);
  });

  it('changing the app language saves, then switches main and tells every window', async () => {
    const t = await setup();
    expect(t.locale.tag).toBe('en-US');
    const result = await t.call('settings.setUiLanguage', { tag: 'es' });
    expect(result.value).toMatchObject({ status: 'saved' });
    expect(t.locale.tag).toBe('es');
    expect(t.locale.t('Settings_LanguageSpanish')).toBe('Español');
    expect(t.events.find((e) => e.name === 'i18n.localeChanged')?.payload).toEqual({
      tag: 'es',
      locale: 'es',
    });
    expect(JSON.parse(fs.readFileSync(t.settingsFile, 'utf8'))).toMatchObject({ uiLanguage: 'es' });
    const again = await t.call('settings.setUiLanguage', { tag: 'es' });
    expect(again.value).toEqual({ status: 'ignored', reason: 'unchanged' });
  });

  it('B11: a language that is not saved does not switch anything', async () => {
    const t = await setup();
    const bad = await t.call('settings.setUiLanguage', { tag: 'fr' });
    expect(bad.value).toEqual({ status: 'ignored', reason: 'invalid' });
    expect(t.locale.tag).toBe('en-US');
    expect(t.events).toEqual([]);
    // Make the save fail: the settings path is a folder.
    fs.mkdirSync(t.settingsFile);
    const failed = await t.call('settings.setUiLanguage', { tag: 'es' });
    expect(failed.value).toMatchObject({ status: 'failed' });
    expect(t.locale.tag).toBe('en-US');
    expect(t.events).toEqual([]);
  });

  it('item 23: the startup language is the saved one, the OS one, or English', async () => {
    const saved = await setup({ os: ['en-US'] });
    await saved.call('settings.setUiLanguage', { tag: 'es' });
    const load = () => saved.store.load();
    expect(await resolveStartupLanguage(load, ['en-US'])).toEqual({ tag: 'es', saved: true });
    const blank = async () => ({ ...(await load()), uiLanguage: ' ' });
    expect(await resolveStartupLanguage(blank, ['es-MX'])).toEqual({ tag: 'es', saved: false });
    expect(
      await resolveStartupLanguage(() => Promise.reject(new Error('EACCES')), ['es-ES']),
    ).toEqual({ tag: 'es', saved: false });
    expect(await resolveStartupLanguage(load, [])).toEqual({ tag: 'es', saved: true });
    const unset = () => Promise.resolve(readSettings({}));
    expect(await resolveStartupLanguage(unset, ['fr-FR'])).toEqual({ tag: 'en-US', saved: false });
  });

  it('i18n.getLocale answers for the first paint', async () => {
    const t = await setup({ os: ['es-MX'] });
    expect((await t.call('i18n.getLocale')).value).toEqual({
      tag: 'es',
      locale: 'es',
      saved: false,
    });
  });

  it('provider, CLI options and languages go through the checked commands', async () => {
    const t = await setup();
    expect((await t.call('settings.setSummaryProvider', { kind: 'Codex' })).value).toMatchObject({
      status: 'saved',
    });
    expect((await t.call('settings.setSummaryProvider', { kind: 'codex' })).value).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
    const option = await t.call('settings.setCliOption', {
      provider: 'codex',
      field: 'effort',
      value: 'high',
    });
    expect(option.value).toMatchObject({
      status: 'saved',
      feedback: { key: 'Xai_FeedbackModel', args: ['gpt-5.6 · high'] },
    });
    expect(
      (await t.call('settings.setMeetingLanguage', { kind: 'summary', code: 'en' })).value,
    ).toMatchObject({ status: 'saved' });
    const page = (await t.call('settings.getPage')).value;
    expect(page).toMatchObject({
      provider: 'Codex',
      cliStatus: 'detected',
      summaryLanguage: 'en',
      codex: { effort: 'high' },
    });
  });

  it('detects the CLI again on request', async () => {
    const t = await setup();
    expect((await t.call('settings.detectCli', { kind: 'Codex' })).value).toEqual({
      status: 'detected',
    });
    expect((await t.call('settings.detectCli', { kind: 'ClaudeCode' })).value).toEqual({
      status: 'missing',
    });
    expect((await t.call('settings.detectCli', { kind: 'Xai' })).value).toEqual({ status: null });
  });

  it('downloads a model with progress events, selects it and deletes it', async () => {
    const t = await setup();
    const file = 'gemma-4-E2B-it-Q4_K_M.gguf';
    const done = await t.call('settings.models.download', { fileName: file });
    expect(done.value).toEqual({ status: 'done' });
    const progress = t.events
      .filter((e) => e.name === 'settings.modelEvent')
      .map((e) => e.payload as ModelEventDto);
    expect(progress.at(-1)).toEqual({ type: 'finished', fileName: file });
    expect(progress.some((p) => p.type === 'progress' && p.percent === 100)).toBe(true);
    expect((await t.call('settings.models.select', { fileName: file })).value).toMatchObject({
      status: 'saved',
    });
    const page = (await t.call('settings.getPage')).value as {
      models: { rows: { fileName: string; active: boolean; downloaded: boolean }[] };
    };
    expect(page.models.rows.find((r) => r.fileName === file)).toMatchObject({
      active: true,
      downloaded: true,
    });
    expect((await t.call('settings.models.delete', { fileName: file })).value).toMatchObject({
      status: 'deleted',
    });
    expect(
      ((await t.call('settings.getPage')).value as { settings: { selectedSummaryModelId: null } })
        .settings.selectedSummaryModelId,
    ).toBeNull();
  });

  it('B5: a failed download comes back as a value and an event', async () => {
    const models = new FakeLocalModelStore();
    models.failWith = new Error('HTTP 503');
    const t = await setup({ models });
    const out = await t.call('settings.models.download', {
      fileName: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    });
    expect(out.value).toEqual({ status: 'failed', message: 'HTTP 503' });
    expect(t.events.at(-1)?.payload).toMatchObject({ type: 'failed', message: 'HTTP 503' });
  });

  it('refuses to touch a file that is not in the catalog', async () => {
    const t = await setup();
    const out = await t.call('settings.models.download', { fileName: '..\\evil.gguf' });
    expect(out.value).toEqual({ status: 'ignored', reason: 'unknown-model' });
    expect((await t.call('settings.models.delete', { fileName: 'x' })).value).toEqual({
      status: 'ignored',
      reason: 'unknown-model',
    });
  });

  it('registers no xai channel, and a saved Xai provider shows the notice until another is chosen', async () => {
    const t = await setup();
    for (const name of ['refresh', 'saveApiKey', 'signOut', 'signIn']) {
      expect(t.registered).not.toContain(`settings.xai.${name}`);
    }
    expect(t.registered.filter((name) => /xai/i.test(name))).toEqual([]);
    fs.writeFileSync(
      t.settingsFile,
      JSON.stringify({ selectedSummaryProvider: 'Xai', selectedXaiModelId: 'grok-4.3' }),
    );
    const page = await t.call('settings.getPage');
    expect(settingsPageSchema.safeParse(page.value).success).toBe(true);
    expect(page.value).toMatchObject({ provider: 'Xai', providerNotice: 'xai-removed' });
    expect((await t.call('settings.setSummaryProvider', { kind: 'Xai' })).value).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
    expect((await t.call('settings.setSummaryProvider', { kind: 'Local' })).value).toMatchObject({
      status: 'saved',
    });
    expect((await t.call('settings.getPage')).value).toMatchObject({ providerNotice: null });
    expect(JSON.parse(fs.readFileSync(t.settingsFile, 'utf8'))).toMatchObject({
      selectedXaiModelId: 'grok-4.3',
    });
  });

  it('restart asks the exit gate and reports a refusal or a failed relaunch', async () => {
    const relaunch = vi.fn();
    const t = await setup({ relaunch });
    const off = t.runtime.exitGates.register(() => false);
    expect((await t.call('app.restart')).value).toEqual({ status: 'refused' });
    expect(relaunch).not.toHaveBeenCalled();
    off();
    expect((await t.call('app.restart')).value).toEqual({ status: 'restarting' });
    expect(relaunch).toHaveBeenCalledOnce();

    const failing = await setup({
      relaunch: () => {
        throw new Error('cannot spawn');
      },
    });
    expect((await failing.call('app.restart')).value).toEqual({
      status: 'failed',
      message: 'cannot spawn',
    });
  });

  it('rejects input that does not match the contract', async () => {
    const t = await setup();
    const bad = await t.call('settings.setCliOption', {
      provider: 'gemini',
      field: 'model',
      value: 'x',
    });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('invalid-input');
    const xai = await t.call('settings.setCliOption', {
      provider: 'xai',
      field: 'model',
      value: 'x',
    });
    expect(xai.ok).toBe(false);
  });
});
