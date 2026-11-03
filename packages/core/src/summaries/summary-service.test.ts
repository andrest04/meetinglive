import { describe, expect, it } from 'vitest';
import { CancelSource, type CancelSignal } from '../cancel';
import type { Clock } from '../clock';
import { InMemoryMeetingRepository, InMemorySettingsStore } from '../library/in-memory-library';
import type { MeetingRecord } from '../library/meeting';
import { CliToolError } from './cli-failure';
import { SummaryError } from './cli-failure-messages';
import { applySummaryPatch } from './meeting-patch';
import {
  CancelledError,
  isCancellation,
  type SummaryProvider,
  type SummaryResult,
} from './provider';
import type { ProviderResolution } from './provider-resolver';
import { describeFailed, SummaryService, type GenerateOutcome } from './summary-service';
import { resolveTemplateInstructions, templateIdToStore } from './template-instructions';

const ID = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const clock: Clock = { now: () => new Date('2026-09-05T15:00:00.000Z') };

const record = (patch: Partial<MeetingRecord> = {}): MeetingRecord => ({
  id: ID,
  title: 'Meeting 2026-09-01 12:00',
  recordedAt: '2026-09-01T12:00:00.0000000+00:00',
  endedAt: '2026-09-01T12:30:00.0000000+00:00',
  audioFilePath: '',
  sourcePath: null,
  folderId: 'folder-1',
  summaryProvider: null,
  calendarEventId: 'evt-1',
  calendarId: 'cal-1',
  seriesId: 'series-1',
  joinUrl: 'https://meet.example/abc',
  noteTemplateId: null,
  attendees: ['Ana', 'Luis'],
  brief: 'Pre-meeting brief',
  transcript: 'Ana: hello\nLuis: hi',
  summary: null,
  actionItems: [],
  jevAnalysis: null,
  notes: 'my raw notes',
  followUp: null,
  projectPlan: null,
  ...patch,
});

const result = (patch: Partial<SummaryResult> = {}): SummaryResult => ({
  summaryMarkdown: '### Summary\nTalked.',
  actionItems: [{ text: 'Send the deck', isDone: false }],
  providerId: 'claude-code',
  suggestedTitle: 'Budget review',
  ...patch,
});

interface Seen {
  request: Parameters<SummaryProvider['summarize']>[0];
  cancel: CancelSignal;
}

function setup(
  options: {
    onSummarize?: (seen: Seen, repo: InMemoryMeetingRepository) => Promise<SummaryResult>;
    gate?: ProviderResolution;
    stored?: MeetingRecord;
  } = {},
) {
  const repo = new InMemoryMeetingRepository();
  repo.records.set(ID, options.stored ?? record());
  const settings = new InMemorySettingsStore();
  const seen: Seen[] = [];
  const provider = {
    id: 'claude-code',
    summarize: (request, cancel) => {
      const entry = { request, cancel };
      seen.push(entry);
      return options.onSummarize ? options.onSummarize(entry, repo) : Promise.resolve(result());
    },
  } as SummaryProvider;
  const gate: ProviderResolution = options.gate ?? {
    status: 'ready',
    kind: 'ClaudeCode',
    provider,
  };
  const notified: string[] = [];
  const service = new SummaryService({
    meetings: repo,
    settings,
    resolver: { resolveSummaryProvider: () => Promise.resolve(gate) },
    clock,
    notifyMeetingChanged: (id) => notified.push(id),
    placeholderFormats: ['Meeting {0}', 'Reunión {0}'],
  });
  return { repo, settings, service, seen, notified };
}

const run = (
  service: SummaryService,
  extra: { cancel?: CancelSignal; templateId?: string | null } = {},
): Promise<GenerateOutcome> =>
  service.generate({
    meetingId: ID,
    regenerate: false,
    cancel: extra.cancel ?? new CancelSource().signal,
    ...(extra.templateId === undefined ? {} : { templateId: extra.templateId }),
  });

describe('template instructions (items 184, 185 gap)', () => {
  it('built-ins give their text; auto, blank, unknown and custom give null', () => {
    expect(resolveTemplateInstructions('standup')).toMatch(
      /^Shape the enhanced notes as a standup/,
    );
    expect(resolveTemplateInstructions(' Sales ')).toBeNull();
    for (const id of ['auto', 'AUTO', '', '  ', null, undefined, 'nope', 'custom']) {
      expect(resolveTemplateInstructions(id)).toBeNull();
    }
  });

  it('stores only a built-in id', () => {
    expect(templateIdToStore('one-on-one')).toBe('one-on-one');
    for (const id of ['auto', 'custom', 'nope', '', null]) expect(templateIdToStore(id)).toBeNull();
  });
});

describe('applySummaryPatch', () => {
  it('changes only the five fields', () => {
    const base = record();
    const next = applySummaryPatch(base, {
      summary: 's',
      actionItems: [{ text: 'a', isDone: true }],
      summaryProvider: 'codex',
      noteTemplateId: 'sales',
      title: null,
    });
    expect(next).toEqual({
      ...base,
      summary: 's',
      actionItems: [{ text: 'a', isDone: true }],
      summaryProvider: 'codex',
      noteTemplateId: 'sales',
    });
  });
});

describe('SummaryService.generate', () => {
  it('happy path: saves summary, items, provider and template, and replaces a placeholder title', async () => {
    const { repo, service, notified, seen } = setup();
    const outcome = await run(service, { templateId: 'standup' });
    expect(outcome).toEqual({
      status: 'generated',
      title: 'Budget review',
      titleChanged: true,
      summary: '### Summary\nTalked.',
      actionItems: [{ text: 'Send the deck', isDone: false }],
      providerId: 'claude-code',
    });
    const saved = repo.records.get(ID)!;
    expect(saved).toMatchObject({
      title: 'Budget review',
      summary: '### Summary\nTalked.',
      summaryProvider: 'claude-code',
      noteTemplateId: 'standup',
    });
    expect(notified).toEqual([ID]);
    const request = seen[0]!.request;
    expect(request.outputLanguage).toBe('es');
    expect(request.enhancement).toMatchObject({
      rawNotes: 'my raw notes',
      attendees: ['Ana', 'Luis'],
      agenda: null,
    });
    expect(request.enhancement?.templateInstructions).toMatch(/standup/);
  });

  it('uses the summary language from settings', async () => {
    const { settings, service, seen } = setup();
    await settings.update({ summaryLanguage: 'en' });
    await run(service);
    expect(seen[0]!.request.outputLanguage).toBe('en');
  });

  it('keeps a real title and does not notify', async () => {
    const { repo, service, notified } = setup({ stored: record({ title: 'Weekly sync' }) });
    const outcome = await run(service);
    expect(outcome).toMatchObject({
      status: 'generated',
      title: 'Weekly sync',
      titleChanged: false,
    });
    expect(repo.records.get(ID)!.title).toBe('Weekly sync');
    expect(notified).toEqual([]);
  });

  it('recognizes a Spanish placeholder title', async () => {
    const { service } = setup({ stored: record({ title: 'Reunión 2026-09-01' }) });
    expect(await run(service)).toMatchObject({ titleChanged: true, title: 'Budget review' });
  });

  it('passes no enhancement when there are no notes, attendees or template', async () => {
    const { service, seen } = setup({ stored: record({ notes: null, attendees: [] }) });
    await run(service);
    expect(seen[0]!.request.enhancement).toBeNull();
  });

  it('defaults the template to the stored one; a stored custom id gives no instructions and is cleared', async () => {
    const { repo, service, seen } = setup({ stored: record({ noteTemplateId: 'custom' }) });
    await run(service);
    expect(seen[0]!.request.enhancement?.templateInstructions).toBeNull();
    expect(repo.records.get(ID)!.noteTemplateId).toBeNull();
  });

  it('B4: a rename made during the run survives the save', async () => {
    const { repo, service } = setup({
      onSummarize: (_seen, r) => {
        r.records.set(ID, {
          ...r.records.get(ID)!,
          title: 'My own name',
          notes: 'edited while running',
        });
        return Promise.resolve(result());
      },
    });
    const outcome = await run(service);
    expect(outcome).toMatchObject({
      status: 'generated',
      title: 'My own name',
      titleChanged: false,
    });
    expect(repo.records.get(ID)).toMatchObject({
      title: 'My own name',
      notes: 'edited while running',
      summary: '### Summary\nTalked.',
    });
  });

  it('keeps every other field (Jev, event keys, brief, folder, notes)', async () => {
    const jev = { model: 'm', analyzedAt: 'x' } as unknown as MeetingRecord['jevAnalysis'];
    const stored = record({ jevAnalysis: jev, followUp: 'f', projectPlan: 'p' });
    const { repo, service } = setup({ stored });
    await run(service);
    const saved = repo.records.get(ID)!;
    expect(saved).toEqual({
      ...stored,
      title: 'Budget review',
      summary: '### Summary\nTalked.',
      actionItems: [{ text: 'Send the deck', isDone: false }],
      summaryProvider: 'claude-code',
    });
  });

  it('cancel mid-run reaches the provider, returns cancelled and saves nothing', async () => {
    const source = new CancelSource();
    const { repo, service, notified } = setup({
      onSummarize: ({ cancel }) =>
        new Promise((_resolve, reject) => {
          cancel.onCancel(() => reject(new CancelledError()));
        }),
    });
    const pending = run(service, { cancel: source.signal });
    await Promise.resolve();
    await Promise.resolve();
    source.cancel();
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(repo.records.get(ID)!.summary).toBeNull();
    expect(notified).toEqual([]);
    expect(service.isGenerating(ID)).toBe(false);
  });

  it('a provider that ignores the signal still ends cancelled and unsaved', async () => {
    const source = new CancelSource();
    const { repo, service } = setup({
      onSummarize: () => {
        source.cancel();
        return Promise.resolve(result());
      },
    });
    expect(await run(service, { cancel: source.signal })).toEqual({ status: 'cancelled' });
    expect(repo.records.get(ID)!.summary).toBeNull();
  });

  it('no transcript is a silent no-op: no provider call, no save', async () => {
    for (const transcript of [null, '', '  \n ']) {
      const { repo, service, seen } = setup({ stored: record({ transcript }) });
      expect(await run(service)).toEqual({ status: 'no-transcript' });
      expect(seen).toHaveLength(0);
      expect(repo.records.get(ID)!.summary).toBeNull();
    }
  });

  it('an unknown meeting is not-found', async () => {
    const { repo, service } = setup();
    repo.records.clear();
    expect(await run(service)).toEqual({ status: 'not-found' });
  });

  it('B34: needs-setup is a value, distinct from failed, and nothing runs', async () => {
    const { service, seen } = setup({
      gate: { status: 'needs-setup', kind: 'Local', reason: 'model-missing' },
    });
    expect(await run(service)).toEqual({
      status: 'needs-setup',
      kind: 'Local',
      reason: 'model-missing',
    });
    expect(seen).toHaveLength(0);
  });

  it('Xai is unavailable, not a failure', async () => {
    const { service } = setup({
      gate: { status: 'unavailable', kind: 'Xai', reason: 'xai-removed' },
    });
    expect(await run(service)).toEqual({ status: 'unavailable', reason: 'xai-removed' });
  });

  it('a second generate for the same meeting is busy while the first runs', async () => {
    let release: (r: SummaryResult) => void = () => undefined;
    const { service } = setup({
      onSummarize: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const first = run(service);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.isGenerating(ID)).toBe(true);
    expect(await run(service)).toEqual({ status: 'busy' });
    release(result());
    expect(await first).toMatchObject({ status: 'generated' });
    expect(service.isGenerating(ID)).toBe(false);
  });

  it('failures come back as codes and rebuild into localized text', async () => {
    const translate = (key: string, ...args: unknown[]) => `${key}|${args.join(',')}`;
    const cli = setup({
      onSummarize: () => Promise.reject(new CliToolError('Claude Code', 'NotSignedIn')),
    });
    const outcome = await run(cli.service);
    expect(outcome).toEqual({
      status: 'failed',
      code: 'CliNotSignedIn',
      args: ['Claude Code'],
      detail: null,
    });
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(describeFailed(outcome, translate)).toBe('Error_CliNotSignedIn|Claude Code');

    const local = setup({
      onSummarize: () => Promise.reject(new SummaryError('PromptTooLong', [4000])),
    });
    const second = await run(local.service);
    expect(second).toMatchObject({ status: 'failed', code: 'PromptTooLong', args: [4000] });
    if (second.status !== 'failed') throw new Error('unreachable');
    expect(describeFailed(second, translate)).toBe('Ui_SummaryPromptTooLong|4000');

    const other = setup({ onSummarize: () => Promise.reject(new Error('boom')) });
    const third = await run(other.service);
    expect(third).toMatchObject({ status: 'failed', code: 'Unknown', detail: 'boom' });
    if (third.status !== 'failed') throw new Error('unreachable');
    expect(describeFailed(third, translate)).toBe('boom');
    expect(other.repo.records.get(ID)!.summary).toBeNull();
  });

  it('a cancellation error is cancelled even if the signal was not set', async () => {
    const { service } = setup({ onSummarize: () => Promise.reject(new CancelledError()) });
    expect(isCancellation(new CancelledError())).toBe(true);
    expect(await run(service)).toEqual({ status: 'cancelled' });
  });
});

describe('pipeline options (S15)', () => {
  const withBusy = (agenda: string | null, skip: boolean) => {
    const repo = new InMemoryMeetingRepository();
    repo.records.set(ID, record());
    const seen: Seen['request'][] = [];
    const provider = {
      id: 'claude-code',
      summarize: (request: Seen['request']) => {
        seen.push(request);
        return Promise.resolve(result());
      },
    } as unknown as SummaryProvider;
    const service = new SummaryService({
      meetings: repo,
      settings: new InMemorySettingsStore(),
      resolver: {
        resolveSummaryProvider: () =>
          Promise.resolve({ status: 'ready', kind: 'ClaudeCode', provider } as const),
      },
      clock,
      notifyMeetingChanged: () => undefined,
      busy: { isBusy: () => true },
    });
    return {
      seen,
      outcome: service.generate({
        meetingId: ID,
        regenerate: true,
        cancel: new CancelSource().signal,
        agenda,
        skipBusyProbe: skip,
      }),
    };
  };

  it('refuses a busy meeting unless the pipeline asks to skip the probe', async () => {
    expect(await withBusy(null, false).outcome).toEqual({ status: 'busy' });
    const run2 = withBusy(null, true);
    expect((await run2.outcome).status).toBe('generated');
  });

  it('hands the agenda to the prompt', async () => {
    const run2 = withBusy('1. Budget', true);
    await run2.outcome;
    expect(run2.seen[0]?.enhancement?.agenda).toBe('1. Budget');
  });
});
