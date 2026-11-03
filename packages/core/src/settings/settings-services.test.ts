import { describe, expect, it } from 'vitest';
import type { CancelSignal } from '../cancel';
import { InMemorySettingsStore, type SettingsStore } from '../library';
import { SettingsCommands } from './commands';
import { LocalModelsService, type ModelEvent } from './local-models';
import type { LocalModelStore } from './ports';
import { SUMMARY_MODELS, type SummaryModelInfo } from './summary-models';

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
  });

  it('refuses the removed Xai provider and keeps what is saved', async () => {
    const { store, commands: c } = commands();
    expect(await c.setSummaryProvider('Xai')).toEqual({ status: 'ignored', reason: 'invalid' });
    expect((await store.load()).selectedSummaryProvider).toBeNull();
    await store.update({ selectedSummaryProvider: 'Xai' });
    expect(await c.setSummaryProvider('Xai')).toEqual({ status: 'ignored', reason: 'invalid' });
    expect((await store.load()).selectedSummaryProvider).toBe('Xai');
    expect(await c.setSummaryProvider('Codex')).toMatchObject({ status: 'saved' });
  });

  it('B2: only the three available exact names are accepted', async () => {
    const { store, commands: c } = commands();
    for (const bad of ['codex', '1', '99', ' Codex', '', 'Local ']) {
      expect(await c.setSummaryProvider(bad)).toEqual({ status: 'ignored', reason: 'invalid' });
    }
    expect((await store.load()).selectedSummaryProvider).toBeNull();
  });
});

describe('SettingsCommands: Claude and Codex options', () => {
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

  it('max is a Claude effort but not a Codex one', async () => {
    const { commands: c } = commands();
    expect(await c.setCliOption({ provider: 'codex', field: 'effort', value: 'max' })).toEqual({
      status: 'ignored',
      reason: 'invalid',
    });
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

  it('B18: two concurrent downloads of one file run one transfer and both see its result', async () => {
    const { service, store, events } = models();
    let release!: () => void;
    store.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const a = service.download(first.fileName);
    const b = service.download(first.fileName);
    expect(service.inFlight()).toEqual([{ fileName: first.fileName, percent: 0 }]);
    release();
    expect(await Promise.all([a, b])).toEqual([{ status: 'done' }, { status: 'done' }]);
    expect(store.started).toEqual([first.fileName]);
    expect(events.flatMap((e) => (e.type === 'progress' ? [e.percent] : []))).toEqual([
      10, 55, 100,
    ]);
    expect(events.filter((e) => e.type === 'finished')).toHaveLength(1);
    expect(service.inFlight()).toEqual([]);
  });

  it('B18: a join that arrives mid transfer gets the cancel and failure outcomes too', async () => {
    const { service, store } = models();
    store.failDownload = new Error('HTTP 503');
    const [a, b] = await Promise.all([
      service.download(first.fileName),
      service.download(first.fileName),
    ]);
    expect(a).toEqual({ status: 'failed', message: 'HTTP 503' });
    expect(b).toEqual(a);
    expect(store.started).toEqual([first.fileName]);
    // After the transfer ends, a new call starts a fresh one.
    store.failDownload = null;
    expect(await service.download(first.fileName)).toEqual({ status: 'done' });
    expect(store.started).toHaveLength(2);
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
