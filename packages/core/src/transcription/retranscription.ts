import { CancelSource, type CancelSignal } from '../cancel';
import type { MeetingRecord } from '../library/meeting';
import { starredLineStarts } from './highlights';

/**
 * Re-transcription of a saved meeting through the same pipeline used after Stop (spec 2.5).
 * The pipeline itself belongs to the recording module; this file owns the rules around it.
 */

export type RetranscriptionAvailability = 'Available' | 'NoAudio' | 'Busy';

/** Checked in order: no record or blank path, then a missing file, then busy. */
export function evaluateRetranscription(
  record: Pick<MeetingRecord, 'audioFilePath'> | null,
  isBusy: boolean,
  fileExists: (path: string) => boolean,
): RetranscriptionAvailability {
  if (record === null || record.audioFilePath.trim() === '') return 'NoAudio';
  if (!fileExists(record.audioFilePath)) return 'NoAudio';
  return isBusy ? 'Busy' : 'Available';
}

/** The request the shared pipeline takes. Times are epoch milliseconds, 0 meaning unknown. */
export interface RecordingPipelineRequest {
  readonly meetingId: string;
  readonly audioFilePath: string;
  readonly recordedAt: string;
  readonly endedAt: string | null;
  readonly title: string;
  /** Null so the offline pass becomes the transcript. */
  readonly liveDraft: string | null;
  readonly pausedSeconds: number;
  readonly folderId: string | null;
  /** Elapsed milliseconds of the starred lines of the old transcript (B8). */
  readonly highlightsMs: readonly number[];
  readonly calendarEventId: string | null;
  readonly calendarId: string | null;
  readonly seriesId: string | null;
  readonly joinUrl: string | null;
  readonly attendees: readonly string[];
  readonly brief: string | null;
  readonly agenda: string | null;
  readonly noteTemplateId: string | null;
  readonly templateInstructions: string | null;
}

/**
 * Builds the pipeline request for a saved meeting. The meeting context is kept so the saved
 * record does not lose it. The old stars become highlights again, so they survive (B8).
 */
export function createRetranscriptionRequest(
  record: MeetingRecord,
  templateInstructions: string | null,
): RecordingPipelineRequest {
  return {
    meetingId: record.id,
    audioFilePath: record.audioFilePath,
    recordedAt: record.recordedAt,
    endedAt: record.endedAt,
    title: record.title,
    liveDraft: null,
    pausedSeconds: 0,
    folderId: record.folderId,
    highlightsMs: starredLineStarts(record.transcript ?? ''),
    calendarEventId: record.calendarEventId,
    calendarId: record.calendarId,
    seriesId: record.seriesId,
    joinUrl: record.joinUrl,
    attendees: record.attendees,
    brief: record.brief,
    agenda: null,
    noteTemplateId: record.noteTemplateId,
    templateInstructions,
  };
}

export interface RetranscriptionPipelineCallbacks {
  onStatus(status: string): void;
  onMeetingSaved(meetingId: string): void;
  onMeetingCompleted(): void;
  onSummaryFailedAfterTranscriptSaved(message: string): void;
  /** The pipeline ended with this status line; for a failure it is the message. */
  onFinished(status: string): void;
}

/** Port: the recording pipeline. Adapter: the recording module. */
export interface RetranscriptionPipeline {
  run(
    request: RecordingPipelineRequest,
    callbacks: RetranscriptionPipelineCallbacks,
    cancel: CancelSignal,
  ): Promise<void>;
}

export type RetranscriptionOutcome =
  'Completed' | 'TranscriptOnly' | 'SummaryFailed' | 'Cancelled' | 'Failed';

export interface RetranscriptionResult {
  readonly meetingId: string;
  readonly outcome: RetranscriptionOutcome;
  /** Set for `SummaryFailed` and `Failed` only. */
  readonly message: string | null;
}

export interface RetranscriptionState {
  readonly isRunning: boolean;
  readonly meetingId: string | null;
  /** English status of the pipeline; the page shows its own words for known stages. */
  readonly status: string;
}

export interface RetranscriptionRunnerDeps {
  readonly pipeline: RetranscriptionPipeline;
  /** Resolves the note template text for the record. */
  readonly templateInstructions: (record: MeetingRecord) => Promise<string | null>;
  readonly formatFailure: (error: unknown) => string;
  /** Runs after the pipeline callbacks have been delivered (the UI thread in the old app). */
  readonly defer: (task: () => void) => void;
  readonly onMeetingChanged: (meetingId: string) => void;
}

const IDLE: RetranscriptionState = { isRunning: false, meetingId: null, status: '' };

/** One re-transcription at a time for the whole app. */
export class MeetingRetranscriptionRunner {
  private state: RetranscriptionState = IDLE;
  private cancelSource: CancelSource | null = null;
  private readonly stateListeners = new Set<() => void>();
  private readonly finishedListeners = new Set<(result: RetranscriptionResult) => void>();

  constructor(private readonly deps: RetranscriptionRunnerDeps) {}

  get current(): RetranscriptionState {
    return this.state;
  }

  onStateChanged(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onFinished(listener: (result: RetranscriptionResult) => void): () => void {
    this.finishedListeners.add(listener);
    return () => this.finishedListeners.delete(listener);
  }

  cancel(): void {
    this.cancelSource?.cancel();
  }

  /** Returns false when a run is already going. The result arrives through `onFinished`. */
  async start(record: MeetingRecord): Promise<boolean> {
    if (this.state.isRunning) return false;
    const cancel = new CancelSource();
    this.cancelSource = cancel;
    this.setState({ isRunning: true, meetingId: record.id, status: '' });

    let completed = false;
    let summaryFailure: string | null = null;
    let failure: string | null = null;

    try {
      const instructions = await this.deps.templateInstructions(record);
      const request = createRetranscriptionRequest(record, instructions);
      await this.deps.pipeline.run(
        request,
        {
          onStatus: (status) => {
            this.setState({ ...this.state, status });
          },
          onMeetingSaved: (id) => {
            this.deps.onMeetingChanged(id);
          },
          onMeetingCompleted: () => {
            completed = true;
          },
          onSummaryFailedAfterTranscriptSaved: (message) => {
            summaryFailure = message;
          },
          onFinished: (status) => {
            if (!cancel.cancelled) failure = status;
          },
        },
        cancel.signal,
      );
    } catch (error) {
      // A cancel before the pipeline took over is not a failure.
      if (!cancel.cancelled) failure = this.deps.formatFailure(error);
    }

    this.deps.defer(() => {
      const result = this.resolve(record.id, {
        summaryFailure,
        failure,
        completed,
        cancelled: cancel.cancelled,
      });
      this.cancelSource = null;
      this.setState(IDLE);
      for (const listener of [...this.finishedListeners]) listener(result);
    });
    return true;
  }

  private resolve(
    meetingId: string,
    flags: {
      summaryFailure: string | null;
      failure: string | null;
      completed: boolean;
      cancelled: boolean;
    },
  ): RetranscriptionResult {
    if (flags.summaryFailure !== null) {
      return { meetingId, outcome: 'SummaryFailed', message: flags.summaryFailure };
    }
    if (flags.failure !== null) return { meetingId, outcome: 'Failed', message: flags.failure };
    if (flags.completed) return { meetingId, outcome: 'Completed', message: null };
    if (flags.cancelled) return { meetingId, outcome: 'Cancelled', message: null };
    return { meetingId, outcome: 'TranscriptOnly', message: null };
  }

  private setState(next: RetranscriptionState): void {
    this.state = next;
    for (const listener of [...this.stateListeners]) listener();
  }
}
