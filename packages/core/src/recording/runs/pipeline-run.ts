import { CancelSource } from '../../cancel';
import type { MeetingRecord } from '../../library/meeting';
import type { CaptureNotice } from '../capture-notices';
import type { PipelineHost, PipelineOutcome, RecordingPipeline } from '../pipeline/pipeline';
import type { PipelineRequest } from '../pipeline/request';
import type { Message } from '../recording-status';

/** A status shown on the page: the renderer joins the messages with a space. */
export type StatusLine = readonly Message[];

/** What a run needs from the page that owns it (spec 3.9). Implemented by `RecordingRuns`. */
export interface RunOwner {
  /** The notes box of the page. */
  readonly pageNotes: string;
  readonly isIdle: boolean;
  readonly lastMeetingId: string | null;
  owns(run: PipelineRun): boolean;
  isLatest(run: PipelineRun): boolean;
  setStatus(line: StatusLine): void;
  setLiveTranscript(transcript: string): void;
  /** The latest run's save: the page selects the meeting and shows it. */
  meetingSavedByLatest(record: MeetingRecord): void;
  /** An older run's save: the workspace only refreshes. */
  meetingSavedByOlder(meetingId: string): void;
  releaseSession(run: PipelineRun, line: StatusLine, resetTitle: boolean): boolean;
  /** Queues behind the callbacks already posted. */
  defer(work: () => void): void;
  remove(run: PipelineRun): void;
}

export interface PipelineRunInit {
  readonly meetingId: string;
  /** The notes box content at stop. */
  readonly notesSnapshot: string;
  /** The first hard capture failure of the take, if any. */
  readonly captureFailure: Message | null;
  /** The soft warning that held when the take ended (B-24). */
  readonly softWarning: CaptureNotice | null;
}

/**
 * One take's view of the page (spec 3.9). It owns its cancellation, the first-save and completion
 * futures, and the snapshots taken at stop. Once it released the session or completed, its late
 * callbacks cannot change a newer take.
 */
export class PipelineRun implements PipelineHost {
  readonly cancel = new CancelSource();
  readonly meetingId: string;
  readonly captureFailure: Message | null;
  readonly softWarning: CaptureNotice | null;
  readonly firstSave: Promise<boolean>;
  readonly completion: Promise<void>;

  private readonly notesSnapshot: string;
  private resolveFirstSave!: (saved: boolean) => void;
  private resolveCompletion!: () => void;
  private firstSaveResolved = false;
  private completed = false;
  private lastStatus: StatusLine = [];

  constructor(
    private readonly owner: RunOwner,
    init: PipelineRunInit,
  ) {
    this.meetingId = init.meetingId;
    this.notesSnapshot = init.notesSnapshot;
    this.captureFailure = init.captureFailure;
    this.softWarning = init.softWarning;
    this.firstSave = new Promise<boolean>((resolve) => {
      this.resolveFirstSave = resolve;
    });
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  get currentSessionNotes(): string {
    return this.owner.owns(this) ? this.owner.pageNotes : this.notesSnapshot;
  }

  /**
   * The capture failure of this take comes first (161). The soft warning of the take comes last,
   * so the user is told the saved audio lacks a side (B-24).
   */
  withCaptureFailure(status: Message): StatusLine {
    return [
      ...(this.captureFailure === null ? [] : [this.captureFailure]),
      status,
      ...(this.softWarning === null ? [] : [this.softWarning]),
    ];
  }

  onStatusChanged(status: Message): void {
    if (this.completed || !this.owner.owns(this)) return;
    this.lastStatus = this.withCaptureFailure(status);
    this.owner.setStatus(this.lastStatus);
  }

  onTranscriptRefreshed(transcript: string): void {
    if (this.completed || !this.owner.owns(this)) return;
    this.owner.setLiveTranscript(transcript);
  }

  onMeetingSaved(record: MeetingRecord): void {
    if (this.completed) return;
    this.settleFirstSave(true);
    if (this.owner.isLatest(this)) this.owner.meetingSavedByLatest(record);
    else this.owner.meetingSavedByOlder(record.id);
  }

  onFinished(status: Message): void {
    this.endOrReport(status, false);
  }

  onTitleResetAndFinished(status: Message): void {
    this.endOrReport(status, true);
  }

  onMeetingCompleted(meetingId: string, status: Message): void {
    if (this.completed) return;
    if (this.owner.isIdle && this.owner.lastMeetingId === meetingId) {
      this.owner.setStatus(this.withCaptureFailure(status));
    }
  }

  onSummaryFailedAfterTranscriptSaved(_meetingId: string, status: Message): void {
    this.endOrReport(status, true);
  }

  onSavedWithoutTranscript(_meetingId: string, status: Message): void {
    this.endOrReport(status, true);
  }

  /** Runs the pipeline for this take. Never throws. `complete` always runs, queued behind callbacks. */
  start(
    pipeline: Pick<RecordingPipeline, 'runGuarded'>,
    request: PipelineRequest,
  ): Promise<PipelineOutcome> {
    return pipeline.runGuarded(request, this, this.cancel, () => this.complete());
  }

  /** Cancels the run (the processing bar's Cancel). */
  cancelRun(): void {
    this.cancel.cancel();
  }

  /** Queued behind the callbacks posted before it. */
  complete(): void {
    this.owner.defer(() => {
      if (this.completed) return;
      this.owner.releaseSession(this, this.lastStatus, false);
      this.completed = true;
      this.owner.remove(this);
      this.settleFirstSave(false);
      this.resolveCompletion();
    });
  }

  private endOrReport(status: Message, resetTitle: boolean): void {
    if (this.completed) return;
    const shown = this.withCaptureFailure(status);
    this.lastStatus = shown;
    const released = this.owner.releaseSession(this, shown, resetTitle);
    if (!released && this.owner.isIdle && this.owner.lastMeetingId === this.meetingId) {
      this.owner.setStatus(shown);
    }
  }

  private settleFirstSave(saved: boolean): void {
    if (this.firstSaveResolved) return;
    this.firstSaveResolved = true;
    this.resolveFirstSave(saved);
  }
}
