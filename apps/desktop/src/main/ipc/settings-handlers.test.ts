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
  FakeXaiAccount,
  JsonSettingsStore,
  SettingsRuntime,
} from '@vozella/platform';
import { LocaleState, resolveStartupLanguage } from '../i18n/locale-state';
import { mainCatalogs } from '../i18n/main-catalogs';
import type { IpcEventLike } from '../security/trusted-origin';
import type { IpcMainLike } from './ipc-server';
import {
  modelEventBridge,
  registerSettingsHandlers,
  type XaiSignInResult,
} from './settings-handlers';

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
  xai?: FakeXaiAccount;
  signIn?: () => Promise<XaiSignInResult>;
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
    ...(options.xai ? { xaiAccount: options.xai, xaiSignIn: options.signIn !== undefined } : {}),
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
    ...(options.signIn ? { xaiSignIn: options.signIn } : {}),
  });
  const call = async (name: string, input: unknown = {}) =>
    (await handlers.get(name)?.(event as never, input)) as {
      ok: boolean;
      value?: Record<string, unknown>;
      error?: { code: string };
    };
  return { call, events, runtime, locale, settingsFile, store };
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
      capabilities: { xaiAccount: false, xaiSignIn: false, localModels: true },
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

  it('the xAI controls do nothing until the xAI module registers an account', async () => {
    const t = await setup();
    expect((await t.call('settings.xai.refresh')).value).toMatchObject({ available: false });
    expect((await t.call('settings.xai.saveApiKey', { key: 'abc' })).value).toEqual({
      status: 'ignored',
    });
    expect((await t.call('settings.xai.signIn')).value).toEqual({ status: 'unavailable' });
  });

  it('xAI: save a key, see models, sign out', async () => {
    const xai = new FakeXaiAccount();
    const t = await setup({ xai });
    await t.call('settings.setSummaryProvider', { kind: 'Xai' });
    const saved = await t.call('settings.xai.saveApiKey', { key: '  xai-key  ' });
    expect(saved.value).toMatchObject({
      status: 'saved',
      feedback: { key: 'Xai_FeedbackApiKey' },
      view: { signedIn: true, models: ['grok-4.3', 'grok-4.6'], selectedModelId: 'grok-4.6' },
    });
    const out = await t.call('settings.xai.signOut');
    expect(out.value).toMatchObject({
      status: 'signed-out',
      feedback: { key: 'Xai_FeedbackSignedOut' },
      view: { signedIn: false, models: [] },
    });
  });

  it('B14: a refresh that fails reports the account as signed in with a retry', async () => {
    const xai = new FakeXaiAccount();
    xai.kind = 'ApiKey';
    xai.listError = new Error('ENOTFOUND api.x.ai');
    const t = await setup({ xai });
    expect((await t.call('settings.xai.refresh')).value).toMatchObject({
      signedIn: true,
      title: 'error',
      canRetry: true,
      detail: { kind: 'error', message: 'ENOTFOUND api.x.ai' },
    });
  });

  it('sign in is offered only when the xAI module supplies it', async () => {
    const xai = new FakeXaiAccount();
    const signIn = vi.fn((): Promise<XaiSignInResult> => {
      xai.kind = 'OAuth';
      return Promise.resolve({ status: 'signed-in' });
    });
    const t = await setup({ xai, signIn });
    expect((await t.call('settings.getPage')).value).toMatchObject({
      capabilities: { xaiAccount: true, xaiSignIn: true },
    });
    expect((await t.call('settings.xai.signIn')).value).toMatchObject({
      status: 'signed-in',
      feedback: { key: 'Xai_FeedbackSignedIn' },
      view: { signedIn: true, title: 'super-grok' },
    });
    signIn.mockResolvedValueOnce({ status: 'cancelled' });
    expect((await t.call('settings.xai.signIn')).value).toEqual({ status: 'cancelled' });
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
  });
});
