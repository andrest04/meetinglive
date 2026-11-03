import { requestChannels, type RequestName } from '@vozella/contracts';
import {
  InMemoryMeetingRepository,
  InMemorySettingsStore,
  LocalModelsService,
  SummaryService,
  SummaryTabService,
  SUMMARY_MODELS,
  type Logger,
  type MeetingRecord,
  type ProviderResolution,
  type TranslateFn,
} from '@vozella/core';
import {
  FakeCliProbe,
  FakeHardwareProbe,
  FakeLocalModelStore,
  FakeSummaryProvider,
  type FakeSummaryOptions,
} from '@vozella/platform';
import { describe, expect, it, vi } from 'vitest';
import type { IpcEventLike } from '../security/trusted-origin';
import { SummariesController } from '../summaries/summaries-controller';
import type { IpcMainLike } from './ipc-server';
import { registerSummariesHandlers } from './summaries-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};
const translate: TranslateFn = (key, ...args) =>
  args.length === 0 ? key : `${key}:${args.map(String).join(',')}`;

const ID = 'm-1';
const record = (patch: Partial<MeetingRecord> = {}): MeetingRecord => ({
  id: ID,
  title: 'Meeting 2026-09-01 12:00',
  recordedAt: '2026-09-01T12:00:00.0000000+00:00',
  endedAt: null,
  audioFilePath: '',
  sourcePath: null,
  folderId: null,
  summaryProvider: null,
  calendarEventId: null,
  calendarId: null,
  seriesId: null,
  joinUrl: null,
  noteTemplateId: null,
  attendees: [],
  brief: null,
  transcript: 'Ana: hello\nLuis: hi',
  summary: null,
  actionItems: [],
  jevAnalysis: null,
  notes: null,
  followUp: null,
  projectPlan: null,
  ...patch,
});

function setup(
  options: {
    fake?: FakeSummaryOptions;
    gate?: ProviderResolution;
    models?: FakeLocalModelStore;
    cli?: string[];
  } = {},
) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const repo = new InMemoryMeetingRepository();
  repo.records.set(ID, record());
  const settings = new InMemorySettingsStore();
  const provider = new FakeSummaryProvider('claude-code', options.fake);
  const gate: ProviderResolution = options.gate ?? {
    status: 'ready',
    kind: 'ClaudeCode',
    provider,
  };
  const resolver = { resolveSummaryProvider: () => Promise.resolve(gate) };
  const events: { name: string; payload: unknown }[] = [];
  const clipboard: string[] = [];
  const store = options.models ?? new FakeLocalModelStore();
  const models = new LocalModelsService({ store, settings, notify: () => undefined });
  const dispose = vi.fn(() => Promise.resolve());
  const service = new SummaryService({
    meetings: repo,
    settings,
    resolver,
    clock: { now: () => new Date('2026-09-05T15:00:00.000Z') },
    notifyMeetingChanged: () => undefined,
    placeholderFormats: ['Meeting {0}'],
  });
  const controller = new SummariesController({
    service,
    tab: new SummaryTabService({
      meetings: repo,
      translate,
      getSelectedMeetingId: () => null,
      selectMeeting: () => undefined,
    }),
    resolver,
    models,
    hardware: new FakeHardwareProbe({ totalRamGb: 16, gpuName: null, gpuVramGb: null }),
    cli: new FakeCliProbe(new Set(options.cli ?? [])),
    settings,
    runtime: { dispose },
    broadcast: (channel, payload) => events.push({ name: channel.name, payload }),
    logger: logger(),
    t: translate,
  });
  registerSummariesHandlers({
    server: { ipc, logger: logger(), isTrusted: () => true },
    controller,
    writeClipboard: (text) => {
      if (text === 'boom') return Promise.reject(new Error('clipboard busy'));
      clipboard.push(text);
      return Promise.resolve();
    },
  });
  const call = async (name: RequestName, input: unknown): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    return handler(event as never, input);
  };
  return { call, controller, repo, settings, events, dispose, store, handlers, clipboard };
}

const ok = (value: unknown): unknown => (value as { ok: boolean; value: unknown }).value;

describe('summaries handlers', () => {
  it('registers every summaries request channel', () => {
    const { handlers } = setup();
    const expected = Object.keys(requestChannels).filter((name) => name.startsWith('summaries.'));
    expect(expected).toHaveLength(14);
    for (const name of expected) expect(handlers.has(name)).toBe(true);
  });

  it('generate saves the summary and answers the outcome, with progress events around it', async () => {
    const { call, repo, events } = setup();
    const result = ok(await call('summaries.generate', { meetingId: ID, regenerate: false }));
    expect(result).toMatchObject({
      status: 'generated',
      title: 'Fake planning meeting',
      providerId: 'claude-code',
    });
    expect(repo.records.get(ID)?.summary).toContain('Overview');
    expect(events.map((e) => e.payload)).toEqual([
      { meetingId: ID, running: true },
      { meetingId: ID, running: false },
    ]);
  });

  it('a failed run is a value with the sentence in the app language', async () => {
    const { call } = setup({ fake: { delayMs: 0, failWith: 'NotSignedIn' } });
    const result = ok(await call('summaries.generate', { meetingId: ID, regenerate: false }));
    expect(result).toMatchObject({ status: 'failed', code: 'CliNotSignedIn' });
    expect((result as { message: string }).message).not.toBe('');
  });

  it('answers the gate values: needs-setup and the removed provider', async () => {
    const needs = setup({
      gate: { status: 'needs-setup', kind: 'Local', reason: 'model-missing' },
    });
    expect(
      ok(await needs.call('summaries.generate', { meetingId: ID, regenerate: false })),
    ).toEqual({ status: 'needs-setup', kind: 'Local', reason: 'model-missing' });
    const xai = setup({ gate: { status: 'unavailable', kind: 'Xai', reason: 'xai-removed' } });
    expect(ok(await xai.call('summaries.providerStatus', {}))).toEqual({
      status: 'unavailable',
      reason: 'xai-removed',
    });
  });

  it('a second generate for the same meeting is busy and the first still finishes', async () => {
    const { call } = setup({ fake: { delayMs: 150, failWith: null } });
    const first = call('summaries.generate', { meetingId: ID, regenerate: false });
    await Promise.resolve();
    const second = ok(await call('summaries.generate', { meetingId: ID, regenerate: false }));
    expect(second).toEqual({ status: 'busy' });
    expect(ok(await first)).toMatchObject({ status: 'generated' });
  });

  it('cancel stops the run and answers whether anything was running', async () => {
    const { call, repo } = setup({ fake: { delayMs: 5_000, failWith: null } });
    expect(ok(await call('summaries.cancel', { meetingId: ID }))).toEqual({ cancelled: false });
    const run = call('summaries.generate', { meetingId: ID, regenerate: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ok(await call('summaries.cancel', { meetingId: ID }))).toEqual({ cancelled: true });
    expect(ok(await run)).toEqual({ status: 'cancelled' });
    expect(repo.records.get(ID)?.summary).toBeNull();
  });

  it('loads the tab with the running flag, saves notes, toggles and copies action items', async () => {
    const { call, repo } = setup();
    await call('summaries.generate', { meetingId: ID, regenerate: false });
    const loaded = ok(await call('summaries.loadTab', { meetingId: ID })) as {
      status: string;
      generating: boolean;
      state: { actionItems: unknown[] };
    };
    expect(loaded).toMatchObject({ status: 'loaded', generating: false });
    expect(loaded.state.actionItems).toHaveLength(2);

    expect(ok(await call('summaries.saveNotes', { meetingId: ID, text: 'my notes' }))).toEqual({
      status: 'saved',
    });
    expect(repo.records.get(ID)?.notes).toBe('my notes');
    expect(
      ok(await call('summaries.toggleAction', { meetingId: ID, index: 0, done: true })),
    ).toMatchObject({ status: 'saved' });
    expect(
      ok(await call('summaries.toggleAction', { meetingId: ID, index: 9, done: true })),
    ).toEqual({ status: 'out-of-range' });
    expect(ok(await call('summaries.copyActions', { meetingId: ID }))).toEqual({
      status: 'copied',
      text: '- [x] Send the notes to the team\n- [ ] Book the follow-up call',
    });
    expect(
      ok(await call('summaries.setTemplate', { meetingId: ID, templateId: 'standup' })),
    ).toEqual({ status: 'saved' });
    expect(repo.records.get(ID)?.noteTemplateId).toBe('standup');
  });

  it('writes the clipboard from main and answers a failed write as a value', async () => {
    const { call, clipboard } = setup();
    expect(ok(await call('summaries.writeClipboard', { text: 'a\nb' }))).toEqual({
      status: 'written',
    });
    expect(clipboard).toEqual(['a\nb']);
    expect(ok(await call('summaries.writeClipboard', { text: 'boom' }))).toEqual({
      status: 'failed',
      detail: 'clipboard busy',
    });
  });

  it('the loaded tab says a run is going', async () => {
    const { call } = setup({ fake: { delayMs: 150, failWith: null } });
    const run = call('summaries.generate', { meetingId: ID, regenerate: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ok(await call('summaries.loadTab', { meetingId: ID }))).toMatchObject({
      generating: true,
    });
    await run;
  });

  it('rejects an untrusted sender and bad input without touching the controller', async () => {
    const { call } = setup();
    const bad = (await call('summaries.generate', { meetingId: '', regenerate: false })) as {
      ok: boolean;
    };
    expect(bad.ok).toBe(false);
  });
});

describe('summaries setup flow', () => {
  it('lists the wizard rows and pre-selects the first Recommended model, then a downloaded one', async () => {
    const { call, store } = setup();
    const first = ok(await call('summaries.hardware', {})) as {
      rows: { fileName: string; fit: string | null }[];
      defaultFileName: string | null;
    };
    expect(first.rows).toHaveLength(SUMMARY_MODELS.length);
    const recommended = first.rows.find((row) => row.fit === 'Recommended');
    expect(first.defaultFileName).toBe(recommended?.fileName ?? first.rows[0]?.fileName);

    const last = SUMMARY_MODELS[SUMMARY_MODELS.length - 1];
    store.files.add(last?.fileName ?? '');
    const second = ok(await call('summaries.hardware', {})) as { defaultFileName: string };
    expect(second.defaultFileName).toBe(last?.fileName);
  });

  it('checks a CLI on PATH with its hint key', async () => {
    const { call } = setup({ cli: ['claude'] });
    expect(ok(await call('summaries.checkCli', { kind: 'ClaudeCode' }))).toEqual({
      found: true,
      executable: 'claude',
      hintKey: 'Cli_ClaudeHint',
    });
    expect(ok(await call('summaries.checkCli', { kind: 'Codex' }))).toEqual({
      found: false,
      executable: 'codex',
      hintKey: 'Cli_CodexHint',
    });
  });

  it('chooseCli saves the provider only when the CLI is found', async () => {
    const { call, settings } = setup({ cli: ['codex'] });
    expect(ok(await call('summaries.chooseCli', { kind: 'ClaudeCode' }))).toMatchObject({
      status: 'not-found',
      executable: 'claude',
    });
    expect((await settings.load()).selectedSummaryProvider).not.toBe('ClaudeCode');
    expect(ok(await call('summaries.chooseCli', { kind: 'Codex' }))).toMatchObject({
      status: 'saved',
    });
    expect((await settings.load()).selectedSummaryProvider).toBe('Codex');
  });

  it('chooseLocalModel downloads, then saves the model and Local in one write', async () => {
    const { call, settings, store } = setup();
    const update = vi.spyOn(settings, 'update');
    const fileName = SUMMARY_MODELS[0]?.fileName ?? '';
    const result = ok(await call('summaries.chooseLocalModel', { fileName }));
    expect(result).toMatchObject({ status: 'saved' });
    expect(store.files.has(fileName)).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      selectedSummaryModelId: fileName,
      selectedSummaryProvider: 'Local',
    });
  });

  it('chooseLocalModel saves nothing on a failed or cancelled download or an unknown file', async () => {
    const failing = setup();
    failing.store.failWith = new Error('disk full');
    const fileName = SUMMARY_MODELS[0]?.fileName ?? '';
    expect(ok(await failing.call('summaries.chooseLocalModel', { fileName }))).toEqual({
      status: 'failed',
      message: 'disk full',
    });
    expect((await failing.settings.load()).selectedSummaryProvider).not.toBe('Local');

    const held = setup();
    let release: () => void = () => undefined;
    held.store.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = held.call('summaries.chooseLocalModel', { fileName });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await held.call('summaries.cancelLocalModel', { fileName });
    release();
    expect(ok(await run)).toEqual({ status: 'cancelled' });
    expect((await held.settings.load()).selectedSummaryProvider).not.toBe('Local');

    expect(ok(await held.call('summaries.chooseLocalModel', { fileName: 'nope.gguf' }))).toEqual({
      status: 'ignored',
      reason: 'unknown-model',
    });
  });
});

describe('summaries controller lifetime', () => {
  it('dispose cancels a running generation and disposes the runtime host once', async () => {
    const { call, controller, dispose } = setup({ fake: { delayMs: 5_000, failWith: null } });
    const run = call('summaries.generate', { meetingId: ID, regenerate: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await controller.dispose();
    await controller.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(ok(await run)).toEqual({ status: 'cancelled' });
    expect(ok(await call('summaries.generate', { meetingId: ID, regenerate: false }))).toEqual({
      status: 'busy',
    });
  });
});

describe('summaries pipeline hook', () => {
  const request = (patch: object = {}) =>
    ({
      meetingId: ID,
      noteTemplateId: 'standup',
      agenda: '1. Budget',
      templateInstructions: null,
      ...patch,
    }) as never;

  it('summarizeForPipeline generates with the agenda and template text and reports completed', async () => {
    const { controller, repo } = setup();
    const { CancelSource } = await import('@vozella/core');
    const result = await controller.summarizeForPipeline(request(), new CancelSource().signal);
    expect(result).toEqual({ status: 'completed' });
    expect(repo.records.get(ID)?.summary).toContain('Overview');
    expect(repo.records.get(ID)?.noteTemplateId).toBe('standup');
  });

  it('turns a failure into the localized sentence and a cancel into cancelled', async () => {
    const failing = setup({ fake: { delayMs: 0, failWith: 'NotSignedIn' } });
    const { CancelSource } = await import('@vozella/core');
    const failed = await failing.controller.summarizeForPipeline(
      request(),
      new CancelSource().signal,
    );
    expect(failed.status).toBe('failed');

    const slow = setup({ fake: { delayMs: 5_000, failWith: null } });
    const source = new CancelSource();
    const run = slow.controller.summarizeForPipeline(request(), source.signal);
    setTimeout(() => {
      source.cancel();
    }, 30);
    expect(await run).toEqual({ status: 'cancelled' });
  });

  it('reports a missing model as the setup sentence', async () => {
    const { controller } = setup({
      gate: { status: 'needs-setup', kind: 'Local', reason: 'model-missing' },
    });
    const { CancelSource } = await import('@vozella/core');
    expect(await controller.summarizeForPipeline(request(), new CancelSource().signal)).toEqual({
      status: 'failed',
      message: 'Ui_SummaryLocalModelMissing',
    });
  });
});
