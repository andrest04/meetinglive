import { describe, expect, it } from 'vitest';
import type { CancelSignal } from '../cancel';
import { InMemorySettingsStore, type AppSettings, type SettingsStore } from '../library';
import { SettingsCommands } from './commands';
import { LocalModelsService, type ModelEvent } from './local-models';
import type { LocalModelStore, XaiAccountPort, XaiCredentialKind } from './ports';
import { SUMMARY_MODELS, type SummaryModelInfo } from './summary-models';
import { XaiAccountService } from './xai-account';

const first = SUMMARY_MODELS[1]!;
const second = SUMMARY_MODELS[2]!;

function commands(os: string[] = ['en-US'], store: SettingsStore = new InMemorySettingsStore()) {
  return { store, commands: new SettingsCommands({ store, osLanguages: () => os }) };
}

describe('SettingsCommands: summary provider', () => {
  it('saves the exact enum name and leaves other fields alone', async () => {
    const { store, commands: c } = commands();
    await store.update({ transcriptionLanguage: 'en', selectedCodexEffort: 'high' });
    const result = await c.setSummaryProvider('Codex');
    expect(result.status).toBe('saved');
    const saved = await store.load();
    expect(saved.selectedSummaryProvider).toBe('Codex');
    expect(saved.transcriptionLanguage).toBe('en');
    expect(saved.selectedCodexEffort).toBe('high');
  });

  it('selecting the current provider is a no-op, Local being the default', async () => {
    const { commands: c } = commands();
    expect(await c.setSummaryProvider('Local')).toEqual({ status: 'ignored', reason: 'unchanged' });
    await c.setSummaryProvider('Xai');
    expect(await c.setSummaryProvider('Xai')).toEqual({ status: 'ignored', reason: 'unchanged' });
  });

  it('B2: only the four exact names are accepted', async () => {
    const { store, commands: c } = commands();
    for (const bad of ['codex', '1', '99', ' Codex', '', 'Local ']) {
      expect(await c.setSummaryProvider(bad)).toEqual({ status: 'ignored', reason: 'invalid' });
    }
    expect((await store.load()).selectedSummaryProvider).toBeNull();
  });
});

describe('SettingsCommands: Claude, Codex and xAI options', () => {
  it('saves one field and answers with the feedback line', async () => {
    const { store, commands: c } = commands();
    const result = await c.setCliOption({ provider: 'claude', field: 'model', value: 'opus' });
    expect(result).toMatchObject({
      status: 'saved',
      feedback: { key: 'Xai_FeedbackModel', args: ['opus · low'] },
    });
    const saved = await store.load();
    expect(saved.selectedClaudeModelId).toBe('opus');
    expect(saved.selectedClaudeEffort).toBeNull();
  });

  it('the feedback names the resolved other half', async () => {
    const { commands: c } = commands();
    await c.setCliOption({ provider: 'codex', field: 'model', value: 'gpt-5.5' });
    const result = await c.setCliOption({ provider: 'codex', field: 'effort', value: 'high' });
    expect(result).toMatchObject({ feedback: { args: ['gpt-5.5 · high'] } });
  });

  it('ignores blank, unchanged and unknown values', async () => {
    const { commands: c } = commands();
    const set = (value: string) => c.setCliOption({ provider: 'claude', field: 'effort', value });
    expect(await set('')).toEqual({ status: 'ignored', reason: 'blank' });
    expect(await set('   ')).toEqual({ status: 'ignored', reason: 'blank' });
    expect(await set('low')).toEqual({ status: 'ignored', reason: 'unchanged' });
    expect(await set('ludicrous')).toEqual({ status: 'ignored', reason: 'invalid' });
    expect(await set('max')).toMatchObject({ status: 'saved' });
  });

  it('max is a Claude effort but not a Codex or xAI one', async () => {
    const { commands: c } = commands();
    expect(await c.setCliOption({ provider: 'codex', field: 'effort', value: 'max' })).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
    expect(await c.setCliOption({ provider: 'xai', field: 'effort', value: 'max' })).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
    expect(await c.setCliOption({ provider: 'xai', field: 'effort', value: 'none' })).toMatchObject(
      { status: 'saved' },
    );
  });

  it('an xAI model is any non blank id and is compared with the saved one', async () => {
    const { store, commands: c } = commands();
    expect(
      await c.setCliOption({ provider: 'xai', field: 'model', value: 'grok-4.3' }),
    ).toMatchObject({ status: 'saved', feedback: { args: ['grok-4.3 · low'] } });
    expect(await c.setCliOption({ provider: 'xai', field: 'model', value: 'grok-4.3' })).toEqual({
      status: 'ignored',
      reason: 'unchanged',
    });
    expect((await store.load()).selectedXaiModelId).toBe('grok-4.3');
  });

  it('B13: a stored value outside the list counts as the current value', async () => {
    const { store, commands: c } = commands();
    await store.update({ selectedClaudeModelId: 'gpt-9' });
    expect(await c.setCliOption({ provider: 'claude', field: 'model', value: 'gpt-9' })).toEqual({
      status: 'ignored',
      reason: 'unchanged',
    });
  });
});

describe('SettingsCommands: meeting and summary language', () => {
  it('saves the normalized code', async () => {
    const { store, commands: c } = commands();
    expect(await c.setMeetingLanguage('transcription', ' PT ')).toMatchObject({ status: 'saved' });
    expect((await store.load()).transcriptionLanguage).toBe('pt');
    expect(await c.setMeetingLanguage('summary', 'en')).toMatchObject({ status: 'saved' });
    expect((await store.load()).summaryLanguage).toBe('en');
  });

  it('changes only its own field', async () => {
    const { store, commands: c } = commands();
    await c.setMeetingLanguage('transcription', 'de');
    const saved = await store.load();
    expect(saved.summaryLanguage).toBeNull();
  });

  it('selecting the current entry does nothing, the default being es', async () => {
    const { commands: c } = commands();
    expect(await c.setMeetingLanguage('transcription', 'es')).toEqual({
      status: 'ignored',
      reason: 'unchanged',
    });
    expect(await c.setMeetingLanguage('summary', 'es')).toEqual({
      status: 'ignored',
      reason: 'unchanged',
    });
  });

  it('B6: a stored variant is the current entry, so it is not saved again', async () => {
    const { store, commands: c } = commands();
    await store.update({ transcriptionLanguage: 'ES' });
    expect(await c.setMeetingLanguage('transcription', 'es')).toEqual({
      status: 'ignored',
      reason: 'unchanged',
    });
  });

  it('rejects codes outside the catalog of that picker', async () => {
    const { commands: c } = commands();
    expect(await c.setMeetingLanguage('summary', 'pt')).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
    expect(await c.setMeetingLanguage('transcription', 'xx')).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
  });
});

describe('SettingsCommands: app language', () => {
  it('saves en-US or es only when it differs from what the picker shows', async () => {
    const { store, commands: c } = commands(['es-ES']);
    // Nothing saved and the OS says Spanish: the picker already shows es.
    expect(await c.setUiLanguage('es')).toEqual({ status: 'ignored', reason: 'unchanged' });
    expect(await c.setUiLanguage('en-US')).toMatchObject({ status: 'saved' });
    expect((await store.load()).uiLanguage).toBe('en-US');
    expect(await c.setUiLanguage('en-US')).toEqual({ status: 'ignored', reason: 'unchanged' });
  });

  it('only the two picker tags are accepted', async () => {
    const { store, commands: c } = commands();
    for (const bad of ['fr', 'en', 'es-ES', '', 'EN-us']) {
      expect(await c.setUiLanguage(bad)).toEqual({ status: 'ignored', reason: 'invalid' });
    }
    expect((await store.load()).uiLanguage).toBeNull();
  });
});

describe('SettingsCommands: failures', () => {
  it('a failed save is returned as a value and changes nothing', async () => {
    const broken: SettingsStore = {
      load: () => new InMemorySettingsStore().load(),
      update: () => Promise.reject(new Error('disk full')),
    };
    const { commands: c } = commands(['en-US'], broken);
    expect(await c.setSummaryProvider('Codex')).toEqual({ status: 'failed', message: 'disk full' });
    expect(await c.setUiLanguage('es')).toEqual({ status: 'failed', message: 'disk full' });
  });

  it('B1: two sections saving at once do not lose each other', async () => {
    const { store, commands: c } = commands();
    await Promise.all([
      c.setSummaryProvider('Codex'),
      c.setMeetingLanguage('summary', 'en'),
      c.setCliOption({ provider: 'claude', field: 'effort', value: 'high' }),
    ]);
    const saved = await store.load();
    expect(saved.selectedSummaryProvider).toBe('Codex');
    expect(saved.summaryLanguage).toBe('en');
    expect(saved.selectedClaudeEffort).toBe('high');
  });
});

// ------------------------------------------------------------------ local models

class FakeModelStore implements LocalModelStore {
  readonly files = new Set<string>();
  readonly started: string[] = [];
  gate: Promise<void> | null = null;
  failDownload: Error | null = null;
  failDelete: Error | null = null;
  steps: number[] = [10, 55, 100];

  isDownloaded(model: SummaryModelInfo): Promise<boolean> {
    return Promise.resolve(this.files.has(model.fileName));
  }

  async download(model: SummaryModelInfo, onProgress: (p: number) => void, signal: CancelSignal) {
    this.started.push(model.fileName);
    for (const step of this.steps) onProgress(step);
    if (this.gate) await this.gate;
    if (signal.cancelled) throw new Error('cancelled');
    if (this.failDownload) throw this.failDownload;
    this.files.add(model.fileName);
  }

  delete(model: SummaryModelInfo): Promise<void> {
    if (this.failDelete) return Promise.reject(this.failDelete);
    this.files.delete(model.fileName);
    return Promise.resolve();
  }
}

function models() {
  const store = new FakeModelStore();
  const settings = new InMemorySettingsStore();
  const events: ModelEvent[] = [];
  const service = new LocalModelsService({
    store,
    settings,
    notify: (event) => events.push(event),
  });
  return { store, settings, events, service };
}

describe('LocalModelsService: download', () => {
  it('reports progress, marks finished and does not select the model', async () => {
    const { service, events, settings, store } = models();
    expect(await service.download(first.fileName)).toEqual({ status: 'done' });
    expect(events.flatMap((e) => (e.type === 'progress' ? [e.percent] : []))).toEqual([
      10, 55, 100,
    ]);
    expect(events.at(-1)).toEqual({ type: 'finished', fileName: first.fileName });
    expect(store.files.has(first.fileName)).toBe(true);
    expect((await settings.load()).selectedSummaryModelId).toBeNull();
    expect(service.inFlight()).toEqual([]);
  });

  it('B5: a failure is returned and announced, progress is reset and busy cleared', async () => {
    const { service, events, store } = models();
    store.failDownload = new Error('HTTP 503');
    expect(await service.download(first.fileName)).toEqual({
      status: 'failed',
      message: 'HTTP 503',
    });
    expect(events.at(-1)).toEqual({
      type: 'failed',
      fileName: first.fileName,
      message: 'HTTP 503',
    });
    expect(service.inFlight()).toEqual([]);
  });

  it('B17: a second download of the same file joins the first and starts nothing', async () => {
    const { service, store } = models();
    let release!: () => void;
    store.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = service.download(first.fileName);
    const b = await service.download(first.fileName);
    expect(b).toEqual({ status: 'ignored', reason: 'already-downloading' });
    expect(service.inFlight()).toEqual([{ fileName: first.fileName, percent: 100 }]);
    release();
    expect(await a).toEqual({ status: 'done' });
    expect(store.started).toEqual([first.fileName]);
  });

  it('different models can download at the same time', async () => {
    const { service, store } = models();
    await Promise.all([service.download(first.fileName), service.download(second.fileName)]);
    expect(store.files.size).toBe(2);
  });

  it('refuses unknown files and models already on disk', async () => {
    const { service, store } = models();
    expect(await service.download('evil.gguf')).toEqual({
      status: 'ignored',
      reason: 'unknown-model',
    });
    store.files.add(first.fileName);
    expect(await service.download(first.fileName)).toEqual({
      status: 'ignored',
      reason: 'already-downloaded',
    });
  });

  it('cancel stops the transfer and announces it', async () => {
    const { service, store, events } = models();
    let release!: () => void;
    store.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = service.download(first.fileName);
    service.cancel(first.fileName);
    release();
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(events.at(-1)).toEqual({ type: 'cancelled', fileName: first.fileName });
    expect(store.files.size).toBe(0);
  });
});

describe('LocalModelsService: select and delete', () => {
  it('selects only a downloaded catalog model, saving its file name', async () => {
    const { service, store, settings } = models();
    expect(await service.select(first.fileName)).toEqual({ status: 'ignored', reason: 'invalid' });
    store.files.add(first.fileName);
    expect(await service.select(first.fileName)).toMatchObject({ status: 'saved' });
    expect((await settings.load()).selectedSummaryModelId).toBe(first.fileName);
    expect(await service.select(first.fileName)).toEqual({
      status: 'ignored',
      reason: 'unchanged',
    });
    expect(await service.select('nope.gguf')).toEqual({ status: 'ignored', reason: 'invalid' });
  });

  it('deleting the active model clears the selection', async () => {
    const { service, store, settings } = models();
    store.files.add(first.fileName);
    store.files.add(second.fileName);
    await service.select(first.fileName);
    expect(await service.delete(second.fileName)).toMatchObject({ status: 'deleted' });
    expect((await settings.load()).selectedSummaryModelId).toBe(first.fileName);
    expect(await service.delete(first.fileName)).toMatchObject({ status: 'deleted' });
    expect((await settings.load()).selectedSummaryModelId).toBeNull();
    expect(store.files.size).toBe(0);
  });

  it('B5: a file that cannot be removed is reported and the selection is kept', async () => {
    const { service, store, settings } = models();
    store.files.add(first.fileName);
    await service.select(first.fileName);
    store.failDelete = new Error('EBUSY: resource busy or locked');
    expect(await service.delete(first.fileName)).toEqual({
      status: 'failed',
      message: 'EBUSY: resource busy or locked',
    });
    expect((await settings.load()).selectedSummaryModelId).toBe(first.fileName);
  });

  it('does not delete a model while it downloads', async () => {
    const { service, store } = models();
    let release!: () => void;
    store.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = service.download(first.fileName);
    expect(await service.delete(first.fileName)).toEqual({ status: 'busy' });
    release();
    await pending;
  });
});

describe('LocalModelsService: rows', () => {
  it('B7: an active id whose file is missing is not active and is reported as missing', async () => {
    const { service, settings, store } = models();
    store.files.add(first.fileName);
    await settings.update({ selectedSummaryModelId: second.fileName });
    const rows = await service.rows({ totalRamGb: 16, gpuName: null, gpuVramGb: null });
    expect(rows.rows.map((r) => r.active)).toEqual([false, false, false, false]);
    expect(rows.rows.map((r) => r.downloaded)).toEqual([false, true, false, false]);
    expect(rows.missingActiveId).toBe(second.fileName);
  });

  it('marks the active downloaded model, fit and in flight state', async () => {
    const { service, settings, store } = models();
    store.files.add(second.fileName);
    await settings.update({ selectedSummaryModelId: second.fileName });
    const rows = await service.rows({ totalRamGb: 8, gpuName: null, gpuVramGb: null });
    expect(rows.missingActiveId).toBeNull();
    expect(rows.rows.map((r) => r.fit)).toEqual([
      'Recommended',
      'Recommended',
      'Recommended',
      'NotRecommended',
    ]);
    expect(rows.rows[2]).toMatchObject({
      fileName: second.fileName,
      active: true,
      downloaded: true,
    });
  });

  it('an id that is not in the catalog is reported as missing too', async () => {
    const { service, settings } = models();
    await settings.update({ selectedSummaryModelId: 'old-model.gguf' });
    const rows = await service.rows(null);
    expect(rows.missingActiveId).toBe('old-model.gguf');
    expect(rows.rows.every((r) => !r.active)).toBe(true);
    expect(rows.rows.every((r) => r.fit === null)).toBe(true);
  });
});

// -------------------------------------------------------------------------- xAI

class FakeXai implements XaiAccountPort {
  kind: XaiCredentialKind | null = null;
  modelsOnServer: string[] = ['grok-4.3', 'grok-4.6'];
  listError: Error | null = null;
  tokenCalls = 0;
  savedKey: string | null = null;
  signedOut = 0;

  credentialKind() {
    return Promise.resolve(this.kind);
  }
  getAccessToken() {
    this.tokenCalls += 1;
    return Promise.resolve('token');
  }
  listModels() {
    return this.listError ? Promise.reject(this.listError) : Promise.resolve(this.modelsOnServer);
  }
  saveApiKey(key: string) {
    this.savedKey = key;
    this.kind = 'ApiKey';
    return Promise.resolve();
  }
  signOut() {
    this.signedOut += 1;
    this.kind = null;
    return Promise.resolve();
  }
}

function xai(settings: Partial<AppSettings> = {}) {
  const port = new FakeXai();
  const store = new InMemorySettingsStore();
  const service = new XaiAccountService({ port, store });
  return { port, store, service, ready: store.update(settings) };
}

describe('XaiAccountService', () => {
  it('without a port the account is unavailable', async () => {
    const service = new XaiAccountService({ port: null, store: new InMemorySettingsStore() });
    expect(await service.status()).toMatchObject({ available: false, signedIn: false });
  });

  it('signed out: title, detail, no models', async () => {
    const { service } = xai();
    expect(await service.status()).toMatchObject({
      available: true,
      signedIn: false,
      credentialKind: null,
      title: 'signed-out',
      detail: { kind: 'signed-out' },
      models: [],
      modelsLoaded: false,
    });
  });

  it('status reads only the local store and seeds the saved model, saying that models are loading', async () => {
    const { service, port, ready } = xai({ selectedXaiModelId: 'grok-4.3' });
    await ready;
    port.kind = 'OAuth';
    expect(await service.status()).toMatchObject({
      signedIn: true,
      title: 'super-grok',
      detail: { kind: 'loading-models' },
      models: ['grok-4.3'],
      selectedModelId: 'grok-4.3',
      effort: 'low',
    });
    expect(port.tokenCalls).toBe(0);
  });

  it('refresh: lists models, resolves the id, persists it when it differs, says ready', async () => {
    const { service, port, store, ready } = xai({ selectedXaiModelId: 'grok-gone' });
    await ready;
    port.kind = 'ApiKey';
    const view = await service.refresh();
    expect(view).toMatchObject({
      title: 'api-key',
      models: ['grok-4.3', 'grok-4.6'],
      modelsLoaded: true,
      selectedModelId: 'grok-4.6',
      detail: { kind: 'ready', model: 'grok-4.6', effort: 'low' },
    });
    expect((await store.load()).selectedXaiModelId).toBe('grok-4.6');
  });

  it('refresh keeps a saved id that is listed and does not write', async () => {
    const { service, port, store, ready } = xai({ selectedXaiModelId: 'GROK-4.3' });
    await ready;
    port.kind = 'OAuth';
    const view = await service.refresh();
    expect(view.selectedModelId).toBe('GROK-4.3');
    expect((await store.load()).selectedXaiModelId).toBe('GROK-4.3');
  });

  it('refresh signed out clears the model list', async () => {
    const { service, port } = xai();
    port.kind = 'ApiKey';
    await service.refresh();
    port.kind = null;
    expect(await service.refresh()).toMatchObject({ models: [], signedIn: false });
    expect(port.tokenCalls).toBe(1);
  });

  it('B14: a failed refresh keeps the account and the old models and carries the raw message', async () => {
    const { service, port } = xai();
    port.kind = 'ApiKey';
    await service.refresh();
    port.listError = new Error('ECONNRESET');
    expect(await service.refresh()).toMatchObject({
      signedIn: true,
      title: 'error',
      detail: { kind: 'error', message: 'ECONNRESET' },
      models: ['grok-4.3', 'grok-4.6'],
      modelsLoaded: false,
      canRetry: true,
    });
  });

  it('refresh is single flight', async () => {
    const { service, port } = xai();
    port.kind = 'ApiKey';
    const [a, b] = await Promise.all([service.refresh(), service.refresh()]);
    expect(a).toEqual(b);
    expect(port.tokenCalls).toBe(1);
  });

  it('B12: a refresh that started before a key swap cannot publish its old models', async () => {
    const { service, port, store } = xai();
    port.kind = 'ApiKey';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    port.listModels = async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return ['old-model'];
      }
      return ['new-model'];
    };
    const stale = service.refresh();
    const saving = service.saveApiKey('xai-new');
    release();
    await stale;
    const result = await saving;
    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: 'saved', view: { models: ['new-model'] } });
    expect((await service.status()).models).toEqual(['new-model']);
    expect((await store.load()).selectedXaiModelId).toBe('new-model');
  });

  it('B12: a stale refresh that lands last does not write its old model over the new choice', async () => {
    const { service, port, store } = xai();
    port.kind = 'ApiKey';
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    port.listModels = async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        return ['old-model'];
      }
      return ['new-model'];
    };
    const stale = service.refresh();
    await service.saveApiKey('xai-new');
    expect((await store.load()).selectedXaiModelId).toBe('new-model');
    release();
    await stale;
    expect((await store.load()).selectedXaiModelId).toBe('new-model');
  });

  it('save key: blank is a no-op, otherwise stores, refreshes and says so', async () => {
    const { service, port } = xai();
    expect(await service.saveApiKey('   ')).toEqual({ status: 'ignored' });
    expect(port.savedKey).toBeNull();
    const result = await service.saveApiKey('  xai-abc  ');
    expect(port.savedKey).toBe('xai-abc');
    expect(result).toMatchObject({
      status: 'saved',
      feedback: { key: 'Xai_FeedbackApiKey', args: [] },
      view: { signedIn: true, title: 'api-key', modelsLoaded: true },
    });
  });

  it('B12: a failing credential store is returned as a value', async () => {
    const { service, port } = xai();
    port.saveApiKey = () => Promise.reject(new Error('encryption unavailable'));
    expect(await service.saveApiKey('k')).toEqual({
      status: 'failed',
      message: 'encryption unavailable',
    });
    port.signOut = () => Promise.reject(new Error('locked'));
    expect(await service.signOut()).toEqual({ status: 'failed', message: 'locked' });
  });

  it('sign out clears the account, refreshes and says so', async () => {
    const { service, port } = xai();
    port.kind = 'OAuth';
    await service.refresh();
    const result = await service.signOut();
    expect(result).toMatchObject({
      status: 'signed-out',
      feedback: { key: 'Xai_FeedbackSignedOut' },
      view: { signedIn: false, models: [] },
    });
  });

  it('the ready detail follows a model or effort change', async () => {
    const { service, port, store, ready } = xai();
    await ready;
    port.kind = 'ApiKey';
    await service.refresh();
    await store.update({ selectedXaiModelId: 'grok-4.3', selectedXaiEffort: 'high' });
    expect(await service.status()).toMatchObject({
      detail: { kind: 'ready', model: 'grok-4.3', effort: 'high' },
    });
  });
});
