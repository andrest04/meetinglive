import { describe, expect, it } from 'vitest';
import { CancelSource, type CancelSignal } from '../../cancel';
import type { Clock } from '../../clock';
import type { JevAnalysis } from '../../library/meeting';
import { CliToolError } from '../../summaries/cli-failure';
import { CancelledError, type SummaryProvider, type SummaryResult } from '../../summaries/provider';
import type { ProviderResolution } from '../../summaries/provider-resolver';
import { SummaryService } from '../../summaries/summary-service';
import { placeholderFormats } from '../default-title';
import type { Message } from '../recording-status';
import { RecordingPipeline, type PipelineHost } from './pipeline';
import {
  FakeOfflineTranscriber,
  RecordingHostSpy,
  ScriptedMeetingStore,
  TEST_MEETING_ID,
  makeMeeting,
  makeRequest,
  makeSettings,
} from './pipeline-test-kit';
import { SummaryStage } from './summary-stage';

const OFFLINE = '[00:00.00-00:02.00] offline words';
const DRAFT = '[00:00.00-00:01.00] live words';
const clock: Clock = { now: () => new Date('2026-09-05T15:00:00.000Z') };
const CATALOGS = {
  en: { MeetingTitleFormat: 'Meeting {0}' },
  es: { MeetingTitleFormat: 'Reunión {0}' },
};

const modelResult = (patch: Partial<SummaryResult> = {}): SummaryResult => ({
  summaryMarkdown: '### Summary\nTalked.',
  actionItems: [{ text: 'Send the deck', isDone: false }],
  providerId: 'claude-code',
  suggestedTitle: 'Budget review',
  ...patch,
});

type SummarizeRequest = Parameters<SummaryProvider['summarize']>[0];

interface Options {
  provider?: string | null;
  resolution?: 'ready' | 'needs-setup' | 'unavailable';
  summarize?: (request: SummarizeRequest, cancel: CancelSignal) => Promise<SummaryResult>;
  store?: ScriptedMeetingStore;
  transcriber?: ConstructorParameters<typeof FakeOfflineTranscriber>[0];
  host?: RecordingHostSpy;
  /** 1-based settings load that throws. */
  failSettingsLoad?: number;
}

function harness(options: Options = {}) {
  const store = options.store ?? new ScriptedMeetingStore();
  const host = options.host ?? new RecordingHostSpy();
  const seen: SummarizeRequest[] = [];
  const provider = {
    id: 'claude-code',
    summarize: (request, cancel) => {
      seen.push(request);
      return options.summarize
        ? options.summarize(request, cancel)
        : Promise.resolve(modelResult());
    },
  } as SummaryProvider;
  const resolution: ProviderResolution =
    options.resolution === 'needs-setup'
      ? { status: 'needs-setup', kind: 'ClaudeCode', reason: 'cli-missing' }
      : options.resolution === 'unavailable'
        ? { status: 'unavailable', kind: 'Xai', reason: 'xai-removed' }
        : { status: 'ready', kind: 'ClaudeCode', provider };
  const settings = makeSettings({
    selectedSummaryProvider: options.provider === undefined ? 'ClaudeCode' : options.provider,
  });
  let loads = 0;
  const settingsStore = {
    load: () => {
      loads += 1;
      if (options.failSettingsLoad === loads) return Promise.reject(new Error('settings gone'));
      return Promise.resolve(settings);
    },
    update: () => Promise.resolve(settings),
  };
  const resolver = { resolveSummaryProvider: () => Promise.resolve(resolution) };
  const notified: string[] = [];
  const generator = new SummaryService({
    meetings: store,
    settings: settingsStore,
    resolver,
    clock,
    notifyMeetingChanged: (id) => notified.push(id),
    placeholderFormats: placeholderFormats(CATALOGS),
  });
  const stage = new SummaryStage({
    settings: settingsStore,
    resolver,
    generator,
    translate: (k, ...args) => `${k}(${args.join(',')})`,
  });
  const transcriber = new FakeOfflineTranscriber({ result: OFFLINE, ...options.transcriber });
  const pipeline = new RecordingPipeline({
    meetings: store,
    settings: settingsStore,
    transcriber,
    formatFailure: (e) => (e instanceof Error ? e.message : String(e)),
    summary: stage,
  });
  return { store, host, seen, notified, stage, pipeline, transcriber, cancel: new CancelSource() };
}

const keyOf = (message: Message): string => message.key;

describe('summary stage: completion', () => {
  it('hands off, summarizes, saves the summary and completes (141-145, 147)', async () => {
    const h = harness();
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome).toMatchObject({ kind: 'completed', titleChanged: false });
    const terminal = h.host.terminal;
    expect(terminal.map((e) => e.kind)).toEqual(['titleResetFinished', 'completed']);
    expect(terminal[0]).toMatchObject({ message: { key: 'Status_GeneratingSummary' } });
    expect(terminal[1]).toMatchObject({
      meetingId: TEST_MEETING_ID,
      message: { key: 'Status_DoneWithSummary' },
    });
    const stored = h.store.records.get(TEST_MEETING_ID);
    expect(stored).toMatchObject({
      summary: '### Summary\nTalked.',
      summaryProvider: 'claude-code',
      actionItems: [{ text: 'Send the deck', isDone: false }],
    });
    expect(stored?.transcript).toContain('offline words');
  });

  it('passes the title, recorded time, summary language and ended time to the summary call (143)', async () => {
    const h = harness();
    await h.pipeline.run(makeRequest(), h.host, h.cancel);
    const request = h.seen[0];
    expect(request?.title).toBe('Standup');
    expect(request?.recordedAt.ms).toBe(Date.UTC(2026, 8, 1, 12, 0, 0));
    expect(request?.endedAt?.ms).toBe(Date.UTC(2026, 8, 1, 12, 30, 0));
    expect(request?.outputLanguage).toBeDefined();
    expect(request?.transcript).toContain('offline words');
  });

  it('sends null as ended time when the end is unknown', async () => {
    const h = harness();
    await h.pipeline.run(makeRequest({ endedAtMs: null }), h.host, h.cancel);
    expect(h.seen[0]?.endedAt ?? null).toBeNull();
  });

  it('finishes with the transcription warning when there is one (147)', async () => {
    const h = harness({ transcriber: { result: new Error('engine crashed') } });
    const outcome = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(outcome.kind).toBe('completed');
    const completed = h.host.terminal.find((e) => e.kind === 'completed');
    expect(completed).toMatchObject({
      message: { key: 'Status_LiveDraftKeptTranscriptionFailed', args: ['engine crashed'] },
    });
  });
});

describe('summary stage: notes and enhancement (134, 143)', () => {
  it('reads the session notes at call time, after the hand-off', async () => {
    const host = new RecordingHostSpy();
    host.currentSessionNotes = 'early notes';
    const original = host.onTitleResetAndFinished.bind(host);
    host.onTitleResetAndFinished = (message) => {
      original(message);
      if (message.key === 'Status_GeneratingSummary') host.currentSessionNotes = 'late notes';
    };
    const h = harness({ host });
    await h.pipeline.run(makeRequest(), host, h.cancel);
    expect(h.seen[0]?.enhancement?.rawNotes).toBe('late notes');
  });

  it('adds attendees, agenda and template text, and sends none when all are blank', async () => {
    const full = harness();
    await full.pipeline.run(
      makeRequest({
        attendees: ['Ana', 'Luis'],
        agenda: 'Budget',
        templateInstructions: 'Use bullets',
      }),
      full.host,
      full.cancel,
    );
    // The attendees come from the record the pipeline saved.
    expect(full.seen[0]?.enhancement).toMatchObject({
      attendees: ['Ana', 'Luis'],
      agenda: 'Budget',
      templateInstructions: 'Use bullets',
    });
    const empty = harness();
    empty.host.currentSessionNotes = '   ';
    await empty.pipeline.run(makeRequest({ agenda: '  ' }), empty.host, empty.cancel);
    expect(empty.seen[0]?.enhancement ?? null).toBeNull();
  });
});

describe('summary stage: title (144, 145, B-1)', () => {
  it('replaces the English placeholder title and notifies the workspace', async () => {
    const h = harness();
    const outcome = await h.pipeline.run(
      makeRequest({ title: 'Meeting 2 Nov, 14:05' }),
      h.host,
      h.cancel,
    );
    expect(outcome).toMatchObject({ kind: 'completed', titleChanged: true });
    expect(h.store.records.get(TEST_MEETING_ID)?.title).toBe('Budget review');
    expect(h.notified).toEqual([TEST_MEETING_ID]);
  });

  it('B-1: replaces the Spanish placeholder title too', async () => {
    const h = harness();
    await h.pipeline.run(makeRequest({ title: 'Reunión 2 nov, 14:05' }), h.host, h.cancel);
    expect(h.store.records.get(TEST_MEETING_ID)?.title).toBe('Budget review');
    expect(h.notified).toEqual([TEST_MEETING_ID]);
  });

  it('keeps a title the user wrote and does not notify', async () => {
    const h = harness();
    await h.pipeline.run(makeRequest({ title: 'Quarterly planning' }), h.host, h.cancel);
    expect(h.store.records.get(TEST_MEETING_ID)?.title).toBe('Quarterly planning');
    expect(h.notified).toEqual([]);
  });
});

describe('summary stage: no provider (141)', () => {
  it('ends as done without a summary when no provider is chosen, never calling one', async () => {
    const h = harness({ provider: null });
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome.kind).toBe('no-summary');
    expect(
      h.host.terminal.map((e) => (e.kind === 'titleResetFinished' ? keyOf(e.message) : e.kind)),
    ).toEqual(['Status_DoneNoSummary']);
    expect(h.seen).toEqual([]);
    expect(h.store.records.get(TEST_MEETING_ID)?.summary).toBeNull();
  });

  it('treats an unparsable provider name as not chosen (B-20)', async () => {
    const h = harness({ provider: 'claudecode' });
    expect((await h.pipeline.run(makeRequest(), h.host, h.cancel)).kind).toBe('no-summary');
  });

  it('ends as done without a summary when the provider needs setup, with the transcription warning', async () => {
    const h = harness({ resolution: 'needs-setup', transcriber: { result: new Error('boom') } });
    await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(h.host.terminal).toMatchObject([
      { kind: 'titleResetFinished', message: { key: 'Status_LiveDraftKeptTranscriptionFailed' } },
    ]);
  });

  it('shows the xAI removed text when the settings still select Xai', async () => {
    const h = harness({ provider: 'Xai' });
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome).toMatchObject({
      kind: 'no-summary',
      message: { key: 'Ui_SummaryProviderXaiRemoved' },
    });
    expect(h.host.terminal).toMatchObject([
      { kind: 'titleResetFinished', message: { key: 'Ui_SummaryProviderXaiRemoved' } },
    ]);
    expect(h.seen).toEqual([]);
  });

  it('shows the xAI removed text when the resolver reports it unavailable', async () => {
    const h = harness({ resolution: 'unavailable' });
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome).toMatchObject({ message: { key: 'Ui_SummaryProviderXaiRemoved' } });
  });
});

describe('summary stage: failure and cancellation (148, 149, 163, B-21)', () => {
  it('keeps the transcript and reports the formatted failure when the summary fails', async () => {
    const h = harness({
      summarize: () => Promise.reject(new CliToolError('Claude Code', 'NotSignedIn')),
    });
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome.kind).toBe('summary-failed');
    const failed = h.host.terminal.find((e) => e.kind === 'summaryFailed');
    expect(failed).toMatchObject({
      meetingId: TEST_MEETING_ID,
      message: { key: 'Status_TranscriptSavedSummaryFailed' },
    });
    const stored = h.store.records.get(TEST_MEETING_ID);
    expect(stored?.transcript).toContain('offline words');
    expect(stored?.summary).toBeNull();
  });

  it('B-21: cancelBackgroundSummary stops the summary after the hand-off and keeps the transcript', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const h = harness({
      summarize: (_request, cancel) =>
        new Promise<SummaryResult>((_resolve, reject) => {
          started();
          cancel.onCancel(() => {
            reject(new CancelledError());
          });
        }),
    });
    const run = h.pipeline.run(makeRequest(), h.host, h.cancel);
    await running;
    expect(h.stage.isSummarizing(TEST_MEETING_ID)).toBe(true);
    expect(h.pipeline.cancelBackgroundSummary(TEST_MEETING_ID)).toBe(true);
    const outcome = await run;
    expect(outcome).toMatchObject({
      kind: 'summary-cancelled',
      message: { key: 'Status_CancelledTranscriptSaved' },
    });
    expect(h.host.terminal.map((e) => e.kind)).toEqual([
      'titleResetFinished',
      'titleResetFinished',
    ]);
    expect(h.store.records.get(TEST_MEETING_ID)?.transcript).toContain('offline words');
    expect(h.store.records.get(TEST_MEETING_ID)?.summary).toBeNull();
    expect(h.stage.isSummarizing(TEST_MEETING_ID)).toBe(false);
    expect(h.pipeline.cancelBackgroundSummary(TEST_MEETING_ID)).toBe(false);
  });

  it('a foreground cancel after the hand-off also stops the summary', async () => {
    const h = harness({
      summarize: (_request, cancel) =>
        new Promise<SummaryResult>((_resolve, reject) => {
          cancel.onCancel(() => {
            reject(new CancelledError());
          });
          h.cancel.cancel();
        }),
    });
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome.kind).toBe('summary-cancelled');
  });

  it('cancelling before the hand-off saves the transcript once (148)', async () => {
    const h = harness({ transcriber: { cancelDuring: new CancelSource() } });
    const outcome = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(outcome).toMatchObject({ kind: 'cancelled', transcriptSaved: true });
    expect(h.host.terminal).toMatchObject([
      { kind: 'titleResetFinished', message: { key: 'Status_CancelledTranscriptSaved' } },
    ]);
  });
});

describe('generic failure handler (149)', () => {
  it('with a transcript: reports the summary failed without saving it twice', async () => {
    // Settings loads: 1 offline pass, 2 the stage. The stage's load throws.
    const h = harness({ failSettingsLoad: 2 });
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome).toMatchObject({ kind: 'failed', transcriptSaved: true });
    expect(h.host.terminal).toMatchObject([
      {
        kind: 'summaryFailed',
        message: { key: 'Status_TranscriptSavedSummaryFailed', args: ['settings gone'] },
      },
    ]);
    expect(h.store.saves).toHaveLength(2);
  });

  it('with a draft and a failed transcript save: saves again and reports the summary failed', async () => {
    const store = new ScriptedMeetingStore();
    store.failSaves = new Set([2]);
    const h = harness({ store });
    const outcome = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(outcome).toMatchObject({ kind: 'failed', transcriptSaved: true });
    expect(store.saves).toHaveLength(3);
    expect(h.host.terminal[0]).toMatchObject({ kind: 'summaryFailed' });
  });

  it('nested save failure is a terminal OnFinished so the host never stays Processing', async () => {
    const store = new ScriptedMeetingStore();
    store.failSaves = new Set([2, 3]);
    const h = harness({ store });
    const outcome = await h.pipeline.run(makeRequest({ liveDraft: DRAFT }), h.host, h.cancel);
    expect(outcome).toMatchObject({ kind: 'failed', transcriptSaved: false });
    expect(h.host.terminal).toMatchObject([
      { kind: 'finished', message: { key: 'Error_ProcessRecording', args: ['disk full'] } },
    ]);
  });

  it('without a transcript after the first save: saved-without-transcript with the error', async () => {
    const h = harness();
    h.transcriber.isReady = () => {
      throw new Error('probe crashed');
    };
    const outcome = await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(outcome).toMatchObject({ kind: 'failed', transcriptSaved: false });
    expect(h.host.terminal).toMatchObject([
      {
        kind: 'savedWithoutTranscript',
        meetingId: TEST_MEETING_ID,
        message: { key: 'Error_ProcessRecording', args: ['probe crashed'] },
      },
    ]);
  });
});

describe('host-level guard (150)', () => {
  it('turns an escaping exception into a terminal status and always completes', async () => {
    const h = harness({ failSettingsLoad: 2 });
    const host: PipelineHost = Object.create(h.host) as PipelineHost;
    host.onSummaryFailedAfterTranscriptSaved = () => {
      throw new Error('host broke');
    };
    // The spy records through `this`, so route the terminal call back to it.
    host.onFinished = (m) => {
      h.host.onFinished(m);
    };
    let completed = 0;
    const outcome = await h.pipeline.runGuarded(makeRequest(), host, h.cancel, () => {
      completed += 1;
    });
    expect(outcome.kind).toBe('failed');
    expect(completed).toBe(1);
    expect(h.host.terminal).toMatchObject([
      { kind: 'finished', message: { key: 'Error_ProcessRecording', args: ['host broke'] } },
    ]);
  });

  it('completes after a normal run too', async () => {
    const h = harness();
    let completed = 0;
    await h.pipeline.runGuarded(makeRequest(), h.host, h.cancel, () => {
      completed += 1;
    });
    expect(completed).toBe(1);
  });
});

describe('Jev data (146 dropped)', () => {
  it('keeps an existing Jev section through the summary save', async () => {
    const jev: JevAnalysis = {
      meetingType: 'standup',
      meetingTypeConfidence: 0.9,
      spokenLanguage: 'en',
      urgencyScore: 2,
      urgencyConfidence: null,
      containsDecisions: 1,
      containsCommitments: 0,
      piiRisk: 0,
      summaryFaithful: null,
      suggestedFolderId: null,
      folderConfidence: null,
      actionItems: [],
      model: 'm',
      analyzedAt: '2026-09-01T12:40:00+00:00',
    };
    const store = new ScriptedMeetingStore();
    store.records.set(TEST_MEETING_ID, makeMeeting({ jevAnalysis: jev }));
    const h = harness({ store });
    await h.pipeline.run(makeRequest(), h.host, h.cancel);
    expect(store.records.get(TEST_MEETING_ID)?.jevAnalysis).toEqual(jev);
    expect(store.records.get(TEST_MEETING_ID)?.summary).not.toBeNull();
  });
});
