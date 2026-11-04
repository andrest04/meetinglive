import { CancelSource } from '../../cancel';
import { InMemoryMeetingRepository } from '../../library/in-memory-library';
import type { MeetingRecord } from '../../library/meeting';
import type { AppSettings } from '../../library/settings';
import { readSettings } from '../../library/settings';
import type { Message } from '../recording-status';
import {
  RecordingPipeline,
  type OfflineTranscriber,
  type PipelineHost,
  type PreviousAudioKeeper,
} from './pipeline';
import type { PipelineRequest } from './request';

/** Doubles for the pipeline ports. Used by the core tests and the main-process service tests. */

export const TEST_MEETING_ID = '22222222-2222-2222-2222-222222222222';
export const TEST_RECORDED_AT_MS = Date.UTC(2026, 8, 1, 12, 0, 0);
export const TEST_ENDED_AT_MS = Date.UTC(2026, 8, 1, 12, 30, 0);

export function makeRequest(patch: Partial<PipelineRequest> = {}): PipelineRequest {
  return {
    meetingId: TEST_MEETING_ID,
    audioPath: 'C:/lib/standup.wav',
    recordedAtMs: TEST_RECORDED_AT_MS,
    endedAtMs: TEST_ENDED_AT_MS,
    title: 'Standup',
    liveDraft: null,
    pausedDurationMs: 0,
    folderId: null,
    highlightsMs: [],
    ...patch,
  };
}

export function makeMeeting(patch: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: TEST_MEETING_ID,
    title: 'Standup',
    recordedAt: '2026-09-01T12:00:00.0000000+00:00',
    endedAt: null,
    audioFilePath: 'C:/lib/standup.wav',
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
    transcript: null,
    summary: null,
    actionItems: [],
    jevAnalysis: null,
    notes: null,
    followUp: null,
    projectPlan: null,
    ...patch,
  };
}

export function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return { ...readSettings({}), ...patch };
}

/** A store that can fail its saves, remembers every saved record, and can move the audio. */
export class ScriptedMeetingStore extends InMemoryMeetingRepository {
  readonly saves: MeetingRecord[] = [];
  /** 1-based save numbers that throw. */
  failSaves = new Set<number>();
  /** Rewrites the audio path of every stored record, as the file repository does when it moves a WAV. */
  moveAudioTo: string | null = null;

  override save(record: MeetingRecord): Promise<MeetingRecord> {
    this.saves.push(record);
    if (this.failSaves.has(this.saves.length)) return Promise.reject(new Error('disk full'));
    const stored =
      this.moveAudioTo === null ? record : { ...record, audioFilePath: this.moveAudioTo };
    this.records.set(stored.id, stored);
    return Promise.resolve(stored);
  }
}

export interface TranscriberScript {
  ready?: boolean;
  /** Result of the offline pass; an Error is thrown. */
  result?: string | Error;
  /** Progress values reported before the result. */
  progress?: readonly number[];
  /** Cancels this source while the pass runs. */
  cancelDuring?: CancelSource;
}

export class FakeOfflineTranscriber implements OfflineTranscriber {
  calls: Parameters<OfflineTranscriber['transcribe']>[0][] = [];

  constructor(readonly script: TranscriberScript = {}) {}

  isReady(): boolean {
    return this.script.ready ?? true;
  }

  transcribe(request: Parameters<OfflineTranscriber['transcribe']>[0]): Promise<string> {
    this.calls.push(request);
    for (const percent of this.script.progress ?? []) request.onProgress(percent);
    this.script.cancelDuring?.cancel();
    const result = this.script.result ?? '[00:00.00-00:02.00] hello';
    if (this.script.cancelDuring) {
      const error = new Error('cancelled');
      error.name = 'AbortError';
      return Promise.reject(error);
    }
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }
}

export type HostEvent =
  | { readonly kind: 'status'; readonly message: Message }
  | { readonly kind: 'transcript'; readonly text: string }
  | { readonly kind: 'saved'; readonly record: MeetingRecord }
  | { readonly kind: 'finished' | 'titleResetFinished'; readonly message: Message }
  | {
      readonly kind: 'completed' | 'summaryFailed' | 'savedWithoutTranscript';
      readonly meetingId: string;
      readonly message: Message;
    };

export class RecordingHostSpy implements PipelineHost {
  readonly events: HostEvent[] = [];
  currentSessionNotes: string | null = null;

  onStatusChanged(message: Message): void {
    this.events.push({ kind: 'status', message });
  }
  onTranscriptRefreshed(text: string): void {
    this.events.push({ kind: 'transcript', text });
  }
  onMeetingSaved(record: MeetingRecord): void {
    this.events.push({ kind: 'saved', record });
  }
  onFinished(message: Message): void {
    this.events.push({ kind: 'finished', message });
  }
  onTitleResetAndFinished(message: Message): void {
    this.events.push({ kind: 'titleResetFinished', message });
  }
  onMeetingCompleted(meetingId: string, message: Message): void {
    this.events.push({ kind: 'completed', meetingId, message });
  }
  onSummaryFailedAfterTranscriptSaved(meetingId: string, message: Message): void {
    this.events.push({ kind: 'summaryFailed', meetingId, message });
  }
  onSavedWithoutTranscript(meetingId: string, message: Message): void {
    this.events.push({ kind: 'savedWithoutTranscript', meetingId, message });
  }

  /** Everything except status progress, to assert the terminal behavior. */
  get terminal(): HostEvent[] {
    return this.events.filter(
      (e) => e.kind !== 'status' && e.kind !== 'saved' && e.kind !== 'transcript',
    );
  }
}

export class FakePreviousAudioKeeper implements PreviousAudioKeeper {
  readonly kept: string[] = [];
  fail = false;
  keep(audioPath: string): Promise<string> {
    if (this.fail) return Promise.reject(new Error('locked'));
    this.kept.push(audioPath);
    return Promise.resolve(audioPath.replace(/\.wav$/i, ' (previous).wav'));
  }
}

export function createPipelineHarness(
  options: {
    store?: ScriptedMeetingStore;
    settings?: Partial<AppSettings>;
    transcriber?: TranscriberScript;
    keeper?: FakePreviousAudioKeeper | null;
  } = {},
) {
  const store = options.store ?? new ScriptedMeetingStore();
  const transcriber = new FakeOfflineTranscriber(options.transcriber);
  const host = new RecordingHostSpy();
  const cancel = new CancelSource();
  const settings = makeSettings(options.settings);
  const keeper = options.keeper === undefined ? new FakePreviousAudioKeeper() : options.keeper;
  const pipeline = new RecordingPipeline({
    meetings: store,
    settings: { load: () => Promise.resolve(settings) },
    transcriber,
    formatFailure: (e) => (e instanceof Error ? e.message : String(e)),
    ...(keeper ? { previousAudio: keeper } : {}),
  });
  return { store, transcriber, host, cancel, pipeline, keeper };
}
