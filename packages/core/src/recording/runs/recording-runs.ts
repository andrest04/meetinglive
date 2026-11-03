import type { MeetingRecord } from '../../library/meeting';
import {
  captureNotice,
  chooseWarning,
  firstFailure,
  isHardFailure,
  type CaptureEvent,
  type CaptureNotice,
} from '../capture-notices';
import type { Message } from '../recording-status';
import type { RecordingSessionGate } from '../session-gate';
import { PipelineRun, type RunOwner, type StatusLine } from './pipeline-run';

/** The wait for runs to wind down at close (spec 2.16). */
export const CLOSE_GRACE_MS = 30_000;

export interface RunsWorkspacePort {
  /** Also selects the meeting. */
  setLastProcessed(record: MeetingRecord): void;
  notifyMeetingChanged(meetingId: string): void;
  /** Mirrors recording or processing (166). */
  setCaptureActive(active: boolean): void;
}

export interface RunsSessionPort {
  /** Puts a new placeholder title in the title box. */
  resetTitle(): void;
  /** Called after the owning run released the page (restart the idle mic preview). */
  onProcessingFinished(): void;
}

/** Schedules `fn` after `ms`. Returns the function that cancels it. Injected so tests use fake time. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export interface RecordingRunsPorts {
  readonly gate: RecordingSessionGate;
  /** The notes box of the page. */
  readonly notes: () => string;
  readonly workspace: RunsWorkspacePort;
  readonly session: RunsSessionPort;
  readonly schedule: Schedule;
  /** Runs `work` after the callbacks already posted. Default: a microtask. */
  readonly defer?: (work: () => void) => void;
}

export interface CaptureEventResult {
  readonly notice: CaptureNotice;
  /** True when the take must be stopped and processed as a normal stop. */
  readonly stopRecording: boolean;
}

export interface BeginTakeOptions {
  /** Passed by the session views when a take re-records an existing meeting. */
  readonly meetingId?: string | null;
}

/**
 * The gate-aware run state the renderer mirrors (spec 3.9): `runs`, `activeRun`, `latestRun`, the
 * status, the live transcript and the last meeting. UI-free.
 */
export class RecordingRuns implements RunOwner {
  private readonly runList: PipelineRun[] = [];
  private active: PipelineRun | null = null;
  private latest: PipelineRun | null = null;
  private last: MeetingRecord | null = null;
  private statusLine: StatusLine = [];
  private liveText = '';
  private linkedMeetingId: string | null = null;
  private takeBase: Message | null = null;
  private takeFailure: CaptureNotice | null = null;
  private takeWarning: CaptureNotice | null = null;
  private takePhase = false;
  private readonly listeners = new Set<() => void>();
  private readonly deferWork: (work: () => void) => void;

  constructor(private readonly ports: RecordingRunsPorts) {
    this.deferWork = ports.defer ?? ((work) => void Promise.resolve().then(work));
    let active = this.isCaptureActive;
    ports.gate.onChange(() => {
      const next = this.isCaptureActive;
      if (next === active) return;
      active = next;
      ports.workspace.setCaptureActive(next);
      this.emit();
    });
  }

  get runs(): readonly PipelineRun[] {
    return [...this.runList];
  }
  get activeRun(): PipelineRun | null {
    return this.active;
  }
  get latestRun(): PipelineRun | null {
    return this.latest;
  }
  get lastMeeting(): MeetingRecord | null {
    return this.last;
  }
  get lastMeetingId(): string | null {
    return this.last?.id ?? null;
  }
  get status(): StatusLine {
    return this.takePhase ? this.composeTake() : this.statusLine;
  }
  get liveTranscript(): string {
    return this.liveText;
  }
  get pageNotes(): string {
    return this.ports.notes();
  }
  get isIdle(): boolean {
    return this.ports.gate.phase === 'Idle';
  }
  get isRecording(): boolean {
    return this.ports.gate.phase === 'Recording';
  }
  get isProcessing(): boolean {
    return this.ports.gate.phase === 'Processing';
  }
  /** The workspace flag: recording or processing (166). */
  get isCaptureActive(): boolean {
    return this.isRecording || this.isProcessing;
  }
  /** The meeting the current take writes to. Null once the session is released (B-26). */
  get currentMeetingId(): string | null {
    return this.linkedMeetingId;
  }
  get takeCaptureFailure(): CaptureNotice | null {
    return this.takeFailure;
  }
  get takeSoftWarning(): CaptureNotice | null {
    return this.takeWarning;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** History refuses to delete a meeting that is recorded now or that a run may re-save (164). */
  isMeetingInUse(meetingId: string): boolean {
    if (this.runList.some((run) => run.meetingId === meetingId)) return true;
    return this.linkedMeetingId === meetingId && this.ports.gate.phase !== 'Idle';
  }

  /** The deleted meeting is no longer the last one (162). */
  clearLastMeetingIf(meetingId: string): void {
    if (this.last?.id !== meetingId) return;
    this.last = null;
    this.emit();
  }

  /**
   * A new take starts. The capture failure and warning of the previous take are cleared, and the
   * only link is the meeting the caller passes for a re-recording (B-26).
   */
  beginTake(options: BeginTakeOptions = {}): void {
    this.takeFailure = null;
    this.takeWarning = null;
    this.takeBase = null;
    this.takePhase = true;
    this.linkedMeetingId = options.meetingId ?? null;
    this.liveText = '';
    this.emit();
  }

  /** The status of the take while it records or stops, before a run exists. */
  setTakeStatus(base: Message | null): void {
    this.takePhase = true;
    this.takeBase = base;
    this.emit();
  }

  /**
   * One capture event (spec 2.17). Only the first hard failure per take is handled; null for a
   * repeat. A warning is shown while recording and kept for the post-stop status (B-24). The
   * status is always composed as failure first, then the latest base, so the order never depends
   * on which event arrived first (B-30).
   */
  noteCaptureEvent(event: CaptureEvent): CaptureEventResult | null {
    const notice = captureNotice(event);
    if (isHardFailure(notice)) {
      const first = firstFailure(this.takeFailure, notice);
      if (first === null) return null;
      this.takeFailure = first;
      this.takePhase = true;
      this.emit();
      return { notice: first, stopRecording: this.isRecording };
    }
    this.takeWarning = chooseWarning(this.takeWarning, notice);
    if (this.isRecording) {
      this.takePhase = true;
      this.takeBase = this.takeWarning;
    }
    this.emit();
    return { notice: this.takeWarning, stopRecording: false };
  }

  /** A stop error never replaces a capture failure that was already notified (B-30). */
  reportStopError(message: Message): void {
    this.setTakeStatus(message);
  }

  /**
   * Stop was accepted: snapshots the notes, the failure and the warning of the take and makes the
   * new run the foreground one. The caller moves the gate.
   */
  startRun(init: { readonly meetingId: string }): PipelineRun {
    const run = new PipelineRun(this, {
      meetingId: init.meetingId,
      notesSnapshot: this.ports.notes(),
      captureFailure: this.takeFailure,
      softWarning: this.takeWarning,
    });
    this.statusLine = this.composeTake();
    this.takePhase = false;
    this.runList.push(run);
    this.active = run;
    this.latest = run;
    this.linkedMeetingId = init.meetingId;
    this.emit();
    return run;
  }

  /** Cancels the foreground run (the processing bar). False when none. */
  cancelActiveRun(): boolean {
    if (this.active === null) return false;
    this.active.cancelRun();
    return true;
  }

  /**
   * Close protection (spec 3.9). `stop` ends any capture. Then every run saves its meeting, every
   * run is cancelled, and the runs get the grace period to wind down. True when every take saved.
   */
  async saveAndFinishForClose(stop: () => Promise<void>): Promise<boolean> {
    await stop();
    const runs = [...this.runList];
    const saved = await Promise.all(runs.map((run) => run.firstSave));
    for (const run of runs) run.cancelRun();
    await this.waitForCompletions(runs);
    return saved.every(Boolean);
  }

  private waitForCompletions(runs: readonly PipelineRun[]): Promise<void> {
    return new Promise<void>((resolve) => {
      const cancelTimer = this.ports.schedule(resolve, CLOSE_GRACE_MS);
      void Promise.all(runs.map((run) => run.completion)).then(() => {
        cancelTimer();
        resolve();
      });
    });
  }

  // -- RunOwner ---------------------------------------------------------------------------------

  owns(run: PipelineRun): boolean {
    return this.active === run;
  }

  isLatest(run: PipelineRun): boolean {
    return this.latest === run;
  }

  setStatus(line: StatusLine): void {
    this.statusLine = line;
    this.emit();
  }

  setLiveTranscript(transcript: string): void {
    this.liveText = transcript;
    this.emit();
  }

  meetingSavedByLatest(record: MeetingRecord): void {
    this.ports.workspace.setLastProcessed(record);
    this.last = record;
    this.emit();
  }

  meetingSavedByOlder(meetingId: string): void {
    this.ports.workspace.notifyMeetingChanged(meetingId);
  }

  /**
   * Gives the page back (idempotent). Only the owning run does anything. Every release clears the
   * link of the take, so the next unrelated Record never reuses a stale meeting id (B-26); the
   * title is reset only when asked.
   */
  releaseSession(run: PipelineRun, line: StatusLine, resetTitle: boolean): boolean {
    if (this.active !== run) return false;
    this.active = null;
    if (resetTitle) this.ports.session.resetTitle();
    this.linkedMeetingId = null;
    this.statusLine = line;
    this.ports.gate.markIdle();
    this.ports.session.onProcessingFinished();
    this.emit();
    return true;
  }

  defer(work: () => void): void {
    this.deferWork(work);
  }

  remove(run: PipelineRun): void {
    const index = this.runList.indexOf(run);
    if (index >= 0) this.runList.splice(index, 1);
    if (this.latest === run) this.latest = this.runList[this.runList.length - 1] ?? null;
    this.emit();
  }

  /** Failure first, then the base, then the held warning once the take no longer records. */
  private composeTake(): StatusLine {
    const warning =
      !this.isRecording && this.takeWarning !== null && this.takeBase !== this.takeWarning
        ? [this.takeWarning]
        : [];
    return [
      ...(this.takeFailure === null ? [] : [this.takeFailure]),
      ...(this.takeBase === null ? [] : [this.takeBase]),
      ...warning,
    ];
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
