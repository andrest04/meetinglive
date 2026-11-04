import {
  recordingLiveText,
  recordingStateChanged,
  type EventChannel,
  type MicrophoneChoiceDto,
  type PayloadInputOf,
  type RecordingMessageDto,
  type RecordingSetupDto,
  type RecordingNoticeDto,
  type RecordingStateDto,
  type SourcePickerStateDto,
} from '@vozella/contracts';
import {
  buildSetupSnapshot,
  CancelSource,
  evaluateSetup,
  HighlightedLiveText,
  RecordingRuns,
  RecordingSessionGate,
  recordingStatusText,
  startFailureMessage,
  type CaptureNotice,
  type Logger,
  type Message,
  type PipelineOutcome,
  type PipelineRequest,
  type ProcessAudioRequest,
  type ProcessAudioResult,
  type RecordingPipeline,
  type RecordingSetupPorts,
  type Schedule,
  type SettingsStore,
  type Workspace,
} from '@vozella/core';
import type { PreviewOwner } from '../audio/audio-controller';
import type { RecordingTakes } from '../audio/recording-take';
import { allocateAudioPath } from './audio-path';
import { convertForImport } from './import-run';

type Broadcast = <C extends EventChannel>(channel: C, payload: PayloadInputOf<C>) => void;

/** The capture half (RecordingTakes): the service owns the take, the takes own the capture. */
export type CapturePort = Pick<
  RecordingTakes,
  'start' | 'pause' | 'resume' | 'stop' | 'lastLiveDraft' | 'currentFile'
>;

/** The slice of AudioController the service uses. */
export interface ControllerPort {
  onNotice(listener: (notice: RecordingNoticeDto) => void): () => void;
  onRecordingLevel(listener: (level: number) => void): () => void;
  startPreview(deviceId: string | null, owner?: PreviewOwner): void;
  stopPreview(owner?: PreviewOwner): void;
  readonly previewState: { owner: PreviewOwner; deviceId: string | null } | null;
  loadMicrophones(userChoice: MicrophoneChoiceDto | null): Promise<{
    selected: MicrophoneChoiceDto;
  }>;
  importAudio(source: string, destination: string): Promise<void>;
  cancelImport(): void;
  startSources(): Promise<SourcePickerStateDto>;
  select(processId: number | null): Promise<SourcePickerStateDto>;
  readonly pickerState: SourcePickerStateDto;
}

export interface LibraryPort {
  /** The directory of a destination folder; the Inbox for null and for an unknown folder. */
  audioDirectory(folderId: string | null): Promise<string>;
  folderExists(folderId: string): Promise<boolean>;
  /** True when the Markdown at this path holds this meeting id. */
  ownsMarkdown(meetingId: string, markdownPath: string): Promise<boolean>;
}

export interface FilesPort {
  remove(file: string): void;
  /** Fixes the header of a WAV a crash left unwritten (188). Never throws. */
  repair(file: string): void;
  /** The last-write time of a file, or null when unreadable. */
  fileTimeMs(file: string): number | null;
  wavDurationSeconds(file: string): number;
}

export interface LiveTextPort {
  /** The live transcript while recording. Returns the unsubscribe. */
  onUpdate(listener: (displayText: string, committedText: string) => void): () => void;
}

/** What the live ask (R7) needs from the take: when it starts, ends, and what was committed. */
export interface LiveAskHooks {
  /** A new take: any answer goes, the web toggle stays. */
  reset(): void;
  /** Stop or Discard: any running answer ends silently. */
  cancel(): void;
  committed(text: string): void;
}

export interface RecordingServiceDeps {
  readonly liveAsk?: LiveAskHooks;
  readonly takes: CapturePort;
  readonly controller: ControllerPort;
  readonly library: LibraryPort;
  readonly files: FilesPort;
  readonly settings: Pick<SettingsStore, 'load'>;
  readonly setup: RecordingSetupPorts;
  readonly pipeline: Pick<RecordingPipeline, 'runGuarded' | 'cancelBackgroundSummary'>;
  readonly workspace: Pick<
    Workspace,
    'setLastProcessed' | 'notifyMeetingChanged' | 'setCaptureActive' | 'setLiveTranscript'
  >;
  readonly live: LiveTextPort;
  readonly broadcast: Broadcast;
  readonly logger: Logger;
  readonly nowMs: () => number;
  readonly newId: () => string;
  readonly schedule: Schedule;
  /** The placeholder title for a take that has none. */
  readonly defaultTitle: (atMs: number) => string;
  /** The title of a saved meeting, for the result card. */
  readonly meetingTitle?: (meetingId: string) => Promise<string | null>;
}

export interface StartRequest {
  readonly title: string;
  readonly folderId: string | null;
  /** Null: the page never loaded the list, so the remembered choice is used (B-23). */
  readonly microphone: MicrophoneChoiceDto | null;
  /** Undefined: restore the remembered app (B-23). Null: all system audio. */
  readonly processId?: number | null;
  readonly appName: string | null;
}

export interface StartOptions {
  /** A meeting the take re-records (the session views pass it). */
  readonly meetingId?: string | null;
}

export interface ImportRequest {
  readonly title: string;
  readonly folderId: string | null;
  readonly path: string;
}

export type ImportResult =
  | { readonly started: true; readonly meetingId: string }
  | {
      readonly started: false;
      readonly reason: 'busy' | 'not-ready' | 'failed' | 'cancelled';
      readonly message: RecordingMessageDto | null;
    };

export type StartResult =
  | { readonly started: true; readonly meetingId: string; readonly recordedAtMs: number }
  | {
      readonly started: false;
      readonly reason: 'busy' | 'not-ready' | 'failed';
      readonly message: RecordingMessageDto | null;
    };

/** How long a close waits for a start or an import in flight, like the 30 s grace of the runs. */
const CLOSE_PREPARING_GRACE_MS = 30_000;
const SOURCE_FALLBACK_KEY = 'RecordPage_SourceFallbackMessage';

interface Take {
  meetingId: string;
  title: string;
  folderId: string | null;
  microphone: MicrophoneChoiceDto;
  appName: string | null;
  audioPath: string;
  recordedAtMs: number;
  /** The instant the elapsed clock started. */
  startedAtMs: number;
  pausedMs: number;
  pausedAtMs: number | null;
  highlights: number[];
}

/**
 * The main-process owner of a take from Record to the saved summary (spec 2.5 to 2.10). It builds
 * on the session gate, the run host and the pipeline of the core, and on `RecordingTakes` for the
 * capture. The page draws the state it publishes and never holds the clock, the notes or the
 * highlights.
 */
export class RecordingService {
  readonly gate = new RecordingSessionGate();
  readonly runs: RecordingRuns;

  private take: Take | null = null;
  private notes = '';
  private title = '';
  private micLevel = 0;
  private frozenElapsedMs = 0;
  private fallbackNotice: CaptureNotice | null = null;
  private stopping: Promise<boolean> | null = null;
  private offNotices: (() => void) | null = null;
  private previewToRestore: { owner: PreviewOwner; deviceId: string | null } | null = null;
  private retry: PipelineRequest | null = null;
  /** The notes of the take whose first save failed: the release clears the live ones (B-11). */
  private retryNotes = '';
  private importCancel: CancelSource | null = null;
  private preparingSettled: Promise<void> = Promise.resolve();
  private readonly canvas = new HighlightedLiveText();
  private readonly offs: (() => void)[] = [];
  private lastState = '';
  private lastLiveText: string | null = null;
  private lastPublishedRaw = '';
  /** The current title of the last processed meeting: a summary can replace a placeholder. */
  private lastTitle: { readonly id: string; readonly title: string } | null = null;

  constructor(private readonly deps: RecordingServiceDeps) {
    this.runs = new RecordingRuns({
      gate: this.gate,
      notes: () => this.notes,
      workspace: {
        setLastProcessed: (record) => {
          deps.workspace.setLastProcessed(record.id);
        },
        notifyMeetingChanged: (id) => {
          deps.workspace.notifyMeetingChanged(id);
        },
        setCaptureActive: (active) => {
          deps.workspace.setCaptureActive(active);
        },
      },
      session: {
        resetTitle: () => {
          this.title = '';
        },
        onProcessingFinished: () => {
          // B-10: the notes belong to the take that just ended. The run keeps its own snapshot.
          this.notes = '';
          this.take = null;
          this.restorePreview();
        },
      },
      schedule: deps.schedule,
    });
    this.offs.push(
      this.runs.subscribe(() => {
        this.publish();
      }),
      this.gate.onChange(() => {
        this.publish();
      }),
      deps.live.onUpdate((displayText, committedText) => {
        this.onLiveUpdate(displayText, committedText);
      }),
      deps.controller.onRecordingLevel((level) => {
        // B-15: no frames arrive while paused, so the bar must not freeze on the last value.
        this.micLevel = this.take?.pausedAtMs === null ? level : 0;
      }),
    );
  }

  dispose(): void {
    this.offNotices?.();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  // -- state ------------------------------------------------------------------------------------

  /** The snapshot the page loads when it opens, with the canvas text. */
  getState(): RecordingStateDto & { liveText: string } {
    return { ...this.buildState(), liveText: this.canvasText() };
  }

  /** The setup checklist (spec 2.4), read from the same facts the Start gate uses. */
  async getSetup(): Promise<RecordingSetupDto> {
    const { facts, readiness } = await evaluateSetup(this.deps.setup);
    return { ...buildSetupSnapshot(facts, readiness), provider: facts.provider };
  }

  /** Resolves when the stop in progress and the latest run have ended. */
  get completion(): Promise<void> {
    const pending = this.stopping;
    return (async () => {
      if (pending !== null) await pending;
      await this.runs.latestRun?.completion;
    })();
  }

  private elapsedMs(now: number): number {
    const take = this.take;
    if (take === null || this.gate.phase !== 'Recording') return this.frozenElapsedMs;
    const end = take.pausedAtMs ?? now;
    return Math.max(0, end - take.startedAtMs - take.pausedMs);
  }

  private buildState(): RecordingStateDto {
    const now = this.deps.nowMs();
    const phase = this.gate.phase;
    const take = this.take;
    const notices = [
      ...(this.runs.takeCaptureFailure === null ? [] : [this.runs.takeCaptureFailure]),
      ...(this.runs.takeSoftWarning === null ? [] : [this.runs.takeSoftWarning]),
      ...(this.fallbackNotice === null ? [] : [this.fallbackNotice]),
    ];
    const last = this.runs.lastMeeting;
    return {
      phase,
      isRecording: phase === 'Recording' || phase === 'Stopping',
      isPaused: phase === 'Recording' && typeof take?.pausedAtMs === 'number',
      isProcessing: phase === 'Processing',
      elapsedMs: this.elapsedMs(now),
      elapsedAsOfMs: now,
      isTicking: phase === 'Recording' && take?.pausedAtMs === null,
      status: this.runs.status.map(typed),
      micLevel: phase === 'Recording' ? this.micLevel : 0,
      captureNotices: notices.map(typed),
      meetingId: this.runs.currentMeetingId ?? take?.meetingId ?? null,
      title: take?.title ?? this.title,
      recordedAtMs: take?.recordedAtMs ?? null,
      highlightCount: take?.highlights.length ?? 0,
      notes: this.notes,
      canRetry: this.retry !== null && phase === 'Idle',
      lastMeeting:
        last === null
          ? null
          : {
              id: last.id,
              title: this.lastTitle?.id === last.id ? this.lastTitle.title : last.title,
            },
    };
  }

  /** Reads the saved title again after the meeting changed, so the result card shows a new one. */
  async refreshLastTitle(meetingId: string): Promise<void> {
    if (this.deps.meetingTitle === undefined || this.runs.lastMeetingId !== meetingId) return;
    try {
      const title = await this.deps.meetingTitle(meetingId);
      if (title === null || this.runs.lastMeetingId !== meetingId) return;
      if (this.lastTitle?.id === meetingId && this.lastTitle.title === title) return;
      this.lastTitle = { id: meetingId, title };
      this.publish();
    } catch (error) {
      this.deps.logger.warn('could not read the saved title', { error: describe(error) });
    }
  }

  /** Sends the state when something other than the clock reading changed. */
  private publish(): void {
    const state = this.buildState();
    const key = JSON.stringify({ ...state, elapsedAsOfMs: 0 });
    if (key !== this.lastState) {
      this.lastState = key;
      this.deps.broadcast(recordingStateChanged, state);
    }
    this.publishLive();
  }

  private canvasText(): string {
    const raw = this.runs.liveTranscript;
    const marks = this.take?.highlights ?? [];
    return this.gate.phase === 'Idle' ? raw : this.canvas.render(raw, marks);
  }

  private publishLive(): void {
    const raw = this.runs.liveTranscript;
    if (raw !== this.lastPublishedRaw) {
      this.lastPublishedRaw = raw;
      // The chat reads the plain transcript (110).
      this.deps.workspace.setLiveTranscript(raw);
    }
    const text = this.canvasText();
    if (text === this.lastLiveText) return;
    this.lastLiveText = text;
    this.deps.broadcast(recordingLiveText, { text });
  }

  private onLiveUpdate(displayText: string, committedText: string): void {
    const phase = this.gate.phase;
    if (phase !== 'Preparing' && phase !== 'Recording' && phase !== 'Stopping') return;
    this.deps.liveAsk?.committed(committedText);
    this.runs.setLiveTranscript(displayText);
  }

  // -- start ------------------------------------------------------------------------------------

  /** Spec 2.5, steps 1 to 14. */
  async start(request: StartRequest, options: StartOptions = {}): Promise<StartResult> {
    const { deps } = this;
    if (!this.gate.tryBeginPreparing()) return { started: false, reason: 'busy', message: null };
    const preparingDone = this.trackPreparing();
    let previewStopped = false;
    try {
      // 2 to 3. The readiness gate. The page shows the setup; nothing is said here.
      const { readiness } = await evaluateSetup(deps.setup);
      if (!readiness.canRecord) return { started: false, reason: 'not-ready', message: null };

      // 4 to 5. Sources: the page's choice, or the remembered one when it never loaded them (B-23).
      const microphone =
        request.microphone ?? (await deps.controller.loadMicrophones(null)).selected;
      if (request.processId === undefined) {
        await deps.controller.startSources();
      } else if (request.processId !== deps.controller.pickerState.selectedProcessId) {
        await deps.controller.select(request.processId);
      }

      // 6 to 8. A fresh take: nothing of the last one survives (B-10, B-26).
      const settings = await deps.settings.load();
      const meetingId = options.meetingId ?? deps.newId();
      this.runs.beginTake({ meetingId: options.meetingId ?? null });
      deps.liveAsk?.reset();
      this.notes = '';
      this.retry = null;
      this.fallbackNotice = null;
      this.micLevel = 0;
      this.frozenElapsedMs = 0;
      this.title = request.title.trim() === '' ? deps.defaultTitle(deps.nowMs()) : request.title;
      const title = this.title;
      const directory = await deps.library.audioDirectory(request.folderId);
      if (settings.liveTranscriptionEnabled) {
        this.runs.setTakeStatus({ key: 'Status_LoadingModel', args: [] });
      }

      // 10. The idle meter gives the microphone to the take; it comes back on a failed start.
      this.previewToRestore = deps.controller.previewState;
      deps.controller.stopPreview();
      previewStopped = true;
      this.offNotices = deps.controller.onNotice((notice) => {
        this.onCaptureEvent(notice);
      });

      // 7, 9, 10. The WAV path, the live session and the capture, in the order of the C# app.
      const outcome = await deps.takes.start(title, microphone, {
        allocate: (name, atMs) =>
          allocateAudioPath({
            directory,
            title: name,
            atMs,
            ownsMarkdown: (markdownPath) => deps.library.ownsMarkdown(meetingId, markdownPath),
          }),
      });
      if (!outcome.started) throw new StartFailure(outcome.code, outcome.message);

      // 11. The elapsed clock starts with the audio.
      const appName = this.activeAppName();
      this.take = {
        meetingId,
        title,
        folderId: request.folderId,
        microphone,
        appName,
        audioPath: outcome.path,
        recordedAtMs: outcome.recordedAtMs,
        startedAtMs: deps.nowMs(),
        pausedMs: 0,
        pausedAtMs: null,
        highlights: [],
      };
      // 48, 49. The app was gone at Record time: the take records all system audio and says so.
      const fallbackApp = deps.controller.pickerState.fallbackAppName;
      if (fallbackApp !== null) {
        this.fallbackNotice = {
          severity: 'warning',
          key: SOURCE_FALLBACK_KEY,
          args: [fallbackApp],
        };
      }
      this.gate.markRecording();

      // 12. A hard failure that arrived before this point is handled now.
      if (this.runs.takeCaptureFailure !== null) {
        await this.stop();
      } else {
        this.runs.setTakeStatus(this.recordingStatus());
      }
      return { started: true, meetingId, recordedAtMs: outcome.recordedAtMs };
    } catch (error) {
      // 13 to 14. Cleanup: events off, the half-started live session and the partial WAV were
      // handled by the take (B-2, B-29). The meter comes back.
      this.offNotices?.();
      this.offNotices = null;
      this.take = null;
      const message = failureMessage(error);
      this.runs.setTakeStatus(message);
      if (previewStopped) this.restorePreview();
      deps.logger.warn('the recording did not start', { error: describe(error) });
      return { started: false, reason: 'failed', message: typed(message) };
    } finally {
      // A no-op once the recording started.
      this.gate.cancelPreparing();
      this.publish();
      preparingDone();
    }
  }

  private activeAppName(): string | null {
    const picker = this.deps.controller.pickerState;
    if (picker.selectedProcessId === null) return null;
    return (
      picker.cards.find((card) => card.processId === picker.selectedProcessId)?.app?.friendlyName ??
      null
    );
  }

  private recordingStatus(): Message {
    const take = this.take;
    if (take === null) return { key: 'Status_Recording', args: [] };
    return recordingStatusText(
      take.microphone,
      take.appName,
      this.runs.takeSoftWarning?.key ?? null,
    );
  }

  private restorePreview(): void {
    const preview = this.previewToRestore;
    this.previewToRestore = null;
    if (preview !== null) this.deps.controller.startPreview(preview.deviceId, preview.owner);
  }

  // -- pause, resume, highlight, notes -----------------------------------------------------------

  async pause(): Promise<boolean> {
    const take = this.take;
    if (take === null || !this.gate.canControlCapture || take.pausedAtMs !== null) return false;
    await this.deps.takes.pause();
    take.pausedAtMs = this.deps.nowMs();
    this.micLevel = 0;
    this.runs.setTakeStatus({ key: 'Status_Paused', args: [] });
    this.publish();
    return true;
  }

  async resume(): Promise<boolean> {
    const take = this.take;
    if (take === null || !this.gate.canControlCapture || take.pausedAtMs === null) return false;
    await this.deps.takes.resume();
    take.pausedMs += this.deps.nowMs() - take.pausedAtMs;
    take.pausedAtMs = null;
    this.runs.setTakeStatus(this.recordingStatus());
    this.publish();
    return true;
  }

  /** Marks this moment in WAV time: the elapsed clock excludes pauses, as the WAV does (69). */
  highlight(): { marked: boolean; elapsedMs: number } {
    const take = this.take;
    if (take === null || !this.gate.canControlCapture) return { marked: false, elapsedMs: 0 };
    const elapsedMs = this.elapsedMs(this.deps.nowMs());
    take.highlights.push(elapsedMs);
    this.publish();
    return { marked: true, elapsedMs };
  }

  /** The notes box. Only a take that records or processes holds notes (130). */
  setNotes(text: string): boolean {
    if (this.gate.phase === 'Idle') return false;
    this.notes = text;
    this.publish();
    return true;
  }

  // -- stop and discard --------------------------------------------------------------------------

  /** Spec 2.10. User stop and capture failure share it; a second caller joins the first. */
  stop(): Promise<boolean> {
    if (this.stopping !== null) return this.stopping;
    if (!this.gate.tryBeginStopping()) return Promise.resolve(false);
    const running = this.runStop().finally(() => {
      this.stopping = null;
    });
    this.stopping = running;
    return running;
  }

  private async runStop(): Promise<boolean> {
    const { deps } = this;
    const take = this.take;
    deps.liveAsk?.cancel();
    this.offNotices?.();
    this.offNotices = null;
    if (take === null) {
      this.gate.markIdle();
      return false;
    }
    // 78. The request is built from what the take holds right now, before the first await.
    const title = take.title;
    const highlights = [...take.highlights];
    const folderId = take.folderId;
    const file = take.audioPath;
    const closedPauseMs = take.pausedAtMs === null ? 0 : deps.nowMs() - take.pausedAtMs;
    this.frozenElapsedMs = this.elapsedMs(deps.nowMs());
    this.take = { ...take, pausedAtMs: null, pausedMs: take.pausedMs + closedPauseMs };
    const visibleText = this.runs.liveTranscript;

    try {
      const outcome = await deps.takes.stop();
      if (outcome.error !== null && this.runs.takeCaptureFailure === null) {
        this.runs.reportStopError({ key: 'Error_StopRecording', args: [outcome.error] });
      }
      const endedAtMs = deps.nowMs();
      const liveDraft =
        deps.takes.lastLiveDraft ?? (visibleText.trim() === '' ? null : visibleText);
      const audioPath = outcome.path ?? file;
      deps.files.repair(audioPath);
      const folder = await this.resolveFolder(folderId);

      this.gate.markProcessing();
      const run = this.runs.startRun({ meetingId: take.meetingId });
      const request: PipelineRequest = {
        meetingId: take.meetingId,
        audioPath,
        recordedAtMs: take.recordedAtMs,
        endedAtMs,
        title,
        liveDraft,
        pausedDurationMs: Math.round(outcome.pausedSeconds * 1000),
        folderId: folder,
        highlightsMs: highlights,
      };
      void this.runPipeline(run, request, this.notes);
      return true;
    } catch (error) {
      deps.logger.error('stopping the recording failed', { error: describe(error) });
      this.runs.reportStopError({ key: 'Error_StopRecording', args: [describe(error)] });
      this.take = null;
      this.gate.markIdle();
      this.publish();
      return false;
    }
  }

  private async runPipeline(
    run: ReturnType<RecordingRuns['startRun']>,
    request: PipelineRequest,
    notes = this.notes,
  ): Promise<void> {
    const outcome: PipelineOutcome = await run.start(this.deps.pipeline, request);
    // B-11: a take whose first save failed can be processed again from the same audio.
    this.retry = outcome.kind === 'first-save-failed' ? request : null;
    this.retryNotes = this.retry === null ? '' : notes;
    this.publish();
  }

  private async resolveFolder(folderId: string | null): Promise<string | null> {
    if (folderId === null) return null;
    try {
      return (await this.deps.library.folderExists(folderId)) ? folderId : null;
    } catch {
      // A failing folder store files the take in the Inbox.
      return null;
    }
  }

  /** Spec 2.6, steps 1 to 6. The page confirmed first. A linked meeting is never touched. */
  async discard(): Promise<boolean> {
    const { deps } = this;
    if (!this.gate.tryBeginStopping()) return false;
    deps.liveAsk?.cancel();
    this.offNotices?.();
    this.offNotices = null;
    const file = this.take?.audioPath ?? deps.takes.currentFile;
    try {
      const outcome = await deps.takes.stop();
      if (outcome.error !== null && this.runs.takeCaptureFailure === null) {
        this.runs.reportStopError({ key: 'Error_StopRecording', args: [outcome.error] });
      }
      const target = outcome.path ?? file;
      if (target !== null) {
        try {
          deps.files.remove(target);
        } catch {
          // A file we cannot delete is left for the user; nothing was saved.
        }
      }
    } catch (error) {
      deps.logger.warn('discarding: stopping the capture failed', { error: describe(error) });
    }
    this.take = null;
    this.notes = '';
    this.micLevel = 0;
    this.frozenElapsedMs = 0;
    this.fallbackNotice = null;
    this.retry = null;
    this.gate.markIdle();
    this.runs.beginTake();
    this.runs.setTakeStatus({ key: 'Status_RecordingDiscarded', args: [] });
    this.restorePreview();
    this.publish();
    return true;
  }

  // -- capture events ----------------------------------------------------------------------------

  /** The title and phase the live ask reads. Asking is allowed only while recording. */
  get liveAskContext(): { recording: boolean; title: string } {
    return { recording: this.gate.phase === 'Recording', title: this.title };
  }

  private onCaptureEvent(event: RecordingNoticeDto): void {
    const result = this.runs.noteCaptureEvent(event);
    if (result === null) return;
    // One hard failure per take: stop it, keep the audio, process it as a normal stop (94).
    if (result.stopRecording) void this.stop();
  }

  // -- processing --------------------------------------------------------------------------------

  /** The processing bar's Cancel. With a meeting id it stops the background summary (B-21). */
  cancelProcessing(meetingId: string | null): boolean {
    if (meetingId === null && this.importCancel !== null) {
      this.importCancel.cancel();
      return true;
    }
    if (meetingId !== null) return this.deps.pipeline.cancelBackgroundSummary(meetingId);
    return this.runs.cancelActiveRun();
  }

  // -- import (2.12) ----------------------------------------------------------------------------

  /**
   * Imports an audio file through the same pipeline as a take: same gate and readiness checks, the
   * file converted to the take WAV, then a request with no live draft, pause or highlights (172).
   */
  async importAudio(request: ImportRequest, options: StartOptions = {}): Promise<ImportResult> {
    const { deps } = this;
    if (!this.gate.tryBeginPreparing()) return { started: false, reason: 'busy', message: null };
    const preparingDone = this.trackPreparing();
    let previewStopped = false;
    const cancel = new CancelSource();
    try {
      const { readiness } = await evaluateSetup(deps.setup);
      if (!readiness.canRecord) return { started: false, reason: 'not-ready', message: null };

      const meetingId = options.meetingId ?? deps.newId();
      this.runs.beginTake({ meetingId: options.meetingId ?? null });
      this.notes = '';
      this.retry = null;
      this.fallbackNotice = null;
      this.title = request.title.trim() === '' ? deps.defaultTitle(deps.nowMs()) : request.title;
      const title = this.title;
      const directory = await deps.library.audioDirectory(request.folderId);
      // 173: the status, and the idle meter stops for the length of the import.
      this.runs.setTakeStatus({ key: 'Status_Importing', args: [] });
      this.previewToRestore = deps.controller.previewState;
      deps.controller.stopPreview();
      previewStopped = true;
      this.importCancel = cancel;
      this.publish();

      const converted = await convertForImport(
        {
          convert: (source, destination) => deps.controller.importAudio(source, destination),
          cancelConversion: () => {
            deps.controller.cancelImport();
          },
          allocate: (name, atMs) =>
            allocateAudioPath({
              directory,
              title: name,
              atMs,
              ownsMarkdown: (markdownPath) => deps.library.ownsMarkdown(meetingId, markdownPath),
            }),
          wavDurationSeconds: (file) => deps.files.wavDurationSeconds(file),
          remove: (file) => {
            deps.files.remove(file);
          },
          nowMs: deps.nowMs,
        },
        { source: request.path, title, fileTimeMs: deps.files.fileTimeMs(request.path) },
        cancel,
      );
      if (!converted.ok) {
        this.runs.setTakeStatus(converted.message);
        this.restorePreview();
        previewStopped = false;
        return {
          started: false,
          reason: converted.cancelled ? 'cancelled' : 'failed',
          message: typed(converted.message),
        };
      }

      this.take = null;
      this.frozenElapsedMs = 0;
      const folder = await this.resolveFolder(request.folderId);
      this.gate.markProcessing();
      const run = this.runs.startRun({ meetingId });
      void this.runPipeline(run, {
        meetingId,
        audioPath: converted.path,
        recordedAtMs: converted.recordedAtMs,
        endedAtMs: converted.endedAtMs,
        title,
        liveDraft: null,
        pausedDurationMs: 0,
        folderId: folder,
        highlightsMs: [],
      });
      previewStopped = false;
      return { started: true, meetingId };
    } catch (error) {
      deps.logger.warn('the import failed', { error: describe(error) });
      const message: Message = { key: 'Error_ImportAudio', args: [describe(error)] };
      this.runs.setTakeStatus(message);
      if (previewStopped) this.restorePreview();
      return { started: false, reason: 'failed', message: typed(message) };
    } finally {
      this.importCancel = null;
      // A no-op once processing started.
      this.gate.cancelPreparing();
      this.publish();
      preparingDone();
    }
  }

  /**
   * Runs the pipeline on an audio file that already exists: a re-transcription of a saved meeting
   * (id given) or a new meeting (null). The session views call it through the entry points.
   */
  processAudioFile(
    meetingId: string | null,
    audioPath: string,
    request: ProcessAudioRequest,
  ): ProcessAudioResult {
    if (!this.gate.tryBeginPreparing()) return { started: false, reason: 'busy' };
    const id = meetingId ?? this.deps.newId();
    this.notes = '';
    this.retry = null;
    this.runs.beginTake({ meetingId });
    this.gate.markProcessing();
    const run = this.runs.startRun({ meetingId: id });
    void this.runPipeline(run, { ...request, meetingId: id, audioPath });
    this.publish();
    return { started: true, meetingId: id };
  }

  /** Runs the pipeline again on the audio of a take whose first save failed (B-11). */
  retryProcessing(): boolean {
    const request = this.retry;
    if (request === null || !this.gate.tryBeginPreparing()) return false;
    this.retry = null;
    this.runs.beginTake({ meetingId: request.meetingId });
    this.gate.markProcessing();
    // B-11: the first run released the page and cleared its notes; restore them for the new run.
    this.notes = this.retryNotes;
    const run = this.runs.startRun({ meetingId: request.meetingId });
    void this.runPipeline(run, request, this.retryNotes);
    this.publish();
    return true;
  }

  /** A capture in progress (recording or processing), for the shell and the pill. */
  get isCaptureActive(): boolean {
    return this.runs.isCaptureActive;
  }

  /** A deleted meeting is no longer the last one: the result card goes away (162). */
  forgetMeeting(meetingId: string): void {
    this.runs.clearLastMeetingIf(meetingId);
  }

  /** Delete and move refuse a meeting that is recorded now or that a run may re-save (164). */
  isMeetingInUse(meetingId: string): boolean {
    return this.runs.isMeetingInUse(meetingId);
  }

  /** 2.16: recording needs the confirmation. */
  get requiresCloseConfirmation(): boolean {
    return this.gate.requiresCloseConfirmation;
  }

  /** 2.16: a stop in progress or a run that has not saved and wound down. */
  get hasPendingSaves(): boolean {
    return (
      this.gate.phase === 'Preparing' ||
      this.gate.phase === 'Stopping' ||
      this.runs.hasUnfinishedRuns
    );
  }

  /**
   * A start or an import in flight is protected work (101): closing waits for it to reach a stable
   * phase, so the new WAV or import is never abandoned. Returns the call that marks it settled.
   */
  private trackPreparing(): () => void {
    let done: () => void = () => undefined;
    this.preparingSettled = new Promise<void>((resolve) => {
      done = resolve;
    });
    return done;
  }

  /** True when the start or import settled within the close grace. */
  private waitForPreparing(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, CLOSE_PREPARING_GRACE_MS);
      void this.preparingSettled.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /**
   * Close protection (2.16): ends a capture in progress, then lets every take save its meeting.
   * True when every take was saved.
   */
  async shutdown(): Promise<boolean> {
    if (this.gate.phase === 'Preparing' && !(await this.waitForPreparing())) return false;
    return this.runs.saveAndFinishForClose(async () => {
      if (this.gate.phase === 'Recording') await this.stop();
    });
  }
}

class StartFailure extends Error {
  constructor(
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureMessage(error: unknown): Message {
  const code = error instanceof StartFailure ? error.code : null;
  return startFailureMessage(code ?? undefined, describe(error));
}

/** A status entry with its severity: from the notice itself, else from the catalog key. */
function typed(message: Message | CaptureNotice): RecordingMessageDto {
  const severity =
    'severity' in message
      ? message.severity
      : message.key.startsWith('Error_') ||
          message.key === 'Ui_ProcessLoopbackUnsupported' ||
          message.key === 'Ui_TranscriptionEngineUnavailable'
        ? 'error'
        : message.key === 'Ui_SummaryProviderXaiRemoved'
          ? 'warning'
          : 'info';
  return { key: message.key, args: [...message.args], severity };
}
