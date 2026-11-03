import {
  retranscriptionFinished,
  retranscriptionStateChanged,
  transcriptionInstallProgress,
  transcriptionLiveUpdate,
  transcriptionStatusChanged,
  type EngineStatusDto,
  type EventChannel,
  type InstallOutcomeDto,
  type InstallProgressDto,
  type PayloadInputOf,
} from '@vozella/contracts';
import {
  applyHighlights,
  CancelSource,
  droppedPercent,
  ensureEndedHeader,
  evaluateRetranscription,
  MeetingRetranscriptionRunner,
  parseOffsetDate,
  pcm16ToFloat32,
  resolveTranscriptionLanguage,
  TranscriptionCancelledError,
  type CancelSignal,
  type Logger,
  type MeetingBusyRegistry,
  type MeetingRecord,
  type MeetingRepository,
  type RecordingPipelineRequest,
  type RetranscriptionAvailability,
  type RetranscriptionPipeline,
  type RetranscriptionPipelineCallbacks,
  type SettingsStore,
  type TranslateFn,
} from '@vozella/core';
import type { TranscriptionRuntime } from '@vozella/platform';

export type Broadcast = <C extends EventChannel>(channel: C, payload: PayloadInputOf<C>) => void;

export interface TranscriptionControllerDeps {
  readonly runtime: TranscriptionRuntime;
  readonly settings: SettingsStore;
  readonly meetings: MeetingRepository;
  readonly busy: MeetingBusyRegistry;
  readonly broadcast: Broadcast;
  readonly logger: Logger;
  /** Looks a string up in the current app language at the moment of use. */
  readonly t: TranslateFn;
  /** Mixed recording frames (PCM16, 16 kHz mono) while a take runs. Returns the unsubscribe. */
  readonly onRecordingFrames: (listener: (pcm: Uint8Array) => void) => () => void;
  readonly fileExists: (path: string) => boolean;
  /** The note template text for a meeting; the summary module supplies it. */
  readonly templateInstructions?: (record: MeetingRecord) => Promise<string | null>;
  /** Tells the workspace a meeting changed so other views refresh. */
  readonly onMeetingChanged: (meetingId: string) => void;
  readonly formatFailure?: (error: unknown) => string;
  readonly defer?: (task: () => void) => void;
}

export interface LiveStartResult {
  /** False when live transcription is switched off in Settings; only the offline pass will run. */
  readonly active: boolean;
}

/** A run of the offline pass for the recording module (after Stop and after import). */
export interface OfflineRun {
  readonly audioPath: string;
  readonly recordedAtMs: number | null;
  readonly onProgress?: (percent: number) => void;
  readonly cancel?: CancelSignal;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What the pages and the recording module use of the transcription module: the engine state and
 * its downloads, the two settings, the live session fed by the recording frames, the offline
 * pass, and re-transcription of a saved meeting.
 */
export class TranscriptionController {
  private installing: InstallProgressDto | null = null;
  private install: {
    cancel: CancelSource;
    done: Promise<InstallOutcomeDto>;
    kind: 'engine' | 'speaker-model';
  } | null = null;
  private unsubscribeFrames: (() => void) | null = null;
  private unsubscribeUpdates: (() => void) | null = null;
  private lastDisplayText = '';
  private readonly runner: MeetingRetranscriptionRunner;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly deps: TranscriptionControllerDeps) {
    this.runner = new MeetingRetranscriptionRunner({
      pipeline: this.pipeline(),
      templateInstructions: (record) =>
        deps.templateInstructions?.(record) ?? Promise.resolve(null),
      formatFailure: deps.formatFailure ?? messageOf,
      defer: deps.defer ?? ((task) => setImmediate(task)),
      onMeetingChanged: (id) => {
        deps.onMeetingChanged(id);
      },
    });
    this.disposers.push(
      this.runner.onStateChanged(() => {
        deps.broadcast(retranscriptionStateChanged, this.runner.current);
      }),
      this.runner.onFinished((result) => {
        deps.broadcast(retranscriptionFinished, result);
      }),
      // A meeting being re-transcribed cannot be deleted or moved from under the run.
      deps.busy.register({
        isBusy: (id) => this.runner.current.isRunning && this.runner.current.meetingId === id,
      }),
      deps.runtime.status.onChanged(() => {
        void this.publishStatus();
      }),
      deps.runtime.status.onLiveDropsChanged(() => {
        void this.publishStatus();
      }),
    );
  }

  dispose(): void {
    this.install?.cancel.cancel();
    this.runner.cancel();
    this.unsubscribeFrames?.();
    this.unsubscribeUpdates?.();
    for (const dispose of this.disposers) dispose();
  }

  // ------------------------------------------------------------------ status

  async status(): Promise<EngineStatusDto> {
    const { runtime, settings } = this.deps;
    const saved = await settings.load();
    const usage = runtime.status.current;
    const drops = runtime.status.lastLiveDrops;
    return {
      ready: runtime.installer.isReady(),
      modelInstalled: runtime.models.isModelDownloaded(),
      runtimes: { cpu: runtime.runtimes.isReady('cpu'), cuda: runtime.runtimes.isReady('cuda') },
      speakerModelInstalled: runtime.models.isDiarizationModelDownloaded(),
      expectedBackend: await runtime.installer.expectedBackend(),
      usage: usage
        ? {
            backend: usage.backend,
            fallbackReason: usage.fallbackReason,
            diarization: usage.diarization,
          }
        : null,
      liveDroppedPercent: drops ? droppedPercent(drops) : null,
      liveEnabled: saved.liveTranscriptionEnabled,
      speakerLabelsEnabled: saved.speakerDiarizationEnabled,
      language: resolveTranscriptionLanguage(saved),
      installing: this.installing,
    };
  }

  private async publishStatus(): Promise<void> {
    try {
      this.deps.broadcast(transcriptionStatusChanged, await this.status());
    } catch (error) {
      this.deps.logger.warn('could not publish the engine status', { error: messageOf(error) });
    }
  }

  // ---------------------------------------------------------------- download

  /**
   * Downloads what is missing and checks the engine is ready afterwards. A second call while one
   * runs shares the first (B17). Cancelling is not an error.
   */
  ensureEngine(): Promise<InstallOutcomeDto> {
    // A transfer that was cancelled still ends on its own time; a new call waits for it and starts
    // again, so it is not handed the cancelled outcome.
    if (this.install?.cancel.cancelled) return this.install.done.then(() => this.ensureEngine());
    // Another kind of install is not this one: wait for it, then check again.
    if (this.install && this.install.kind !== 'engine') {
      return this.install.done.then(() => this.ensureEngine());
    }
    if (this.install) return this.install.done;
    const cancel = new CancelSource();
    const done = this.runInstall(cancel, async () => {
      await this.deps.runtime.installer.ensure((p) => {
        this.reportProgress({
          stage: p.stage,
          percent: p.percent,
          stepIndex: p.stepIndex,
          stepCount: p.stepCount,
        });
      }, cancel.signal);
      if (!this.deps.runtime.installer.isReady()) {
        return { status: 'failed', message: this.deps.t('Error_EngineNotReady') };
      }
      return { status: 'ready' };
    });
    this.install = { cancel, done, kind: 'engine' };
    return done;
  }

  cancelInstall(): boolean {
    if (!this.install) return false;
    this.install.cancel.cancel();
    return true;
  }

  private async runInstall(
    cancel: CancelSource,
    work: () => Promise<InstallOutcomeDto>,
  ): Promise<InstallOutcomeDto> {
    try {
      return await work();
    } catch (error) {
      if (cancel.cancelled) return { status: 'cancelled' };
      this.deps.logger.warn('engine download failed', { error: messageOf(error) });
      return { status: 'failed', message: messageOf(error) };
    } finally {
      this.installing = null;
      this.install = null;
      void this.publishStatus();
    }
  }

  private reportProgress(progress: InstallProgressDto, publish = true): void {
    this.installing = progress;
    if (publish) this.deps.broadcast(transcriptionInstallProgress, progress);
  }

  async deleteEngine(): Promise<'Deleted' | 'RuntimeInUse' | 'Incomplete'> {
    if (this.install) return 'Incomplete';
    const outcome = await this.deps.runtime.installer.deleteEngine();
    // The engine delete removes the speaker model too, so the labels go off with it (B7).
    if (
      !this.deps.runtime.models.isDiarizationModelDownloaded() &&
      (await this.deps.settings.load()).speakerDiarizationEnabled
    ) {
      await this.deps.settings.update({ speakerDiarizationEnabled: false });
    }
    void this.publishStatus();
    return outcome;
  }

  // ---------------------------------------------------------------- settings

  async setLiveEnabled(enabled: boolean): Promise<boolean> {
    const current = await this.deps.settings.load();
    if (current.liveTranscriptionEnabled === enabled) return false;
    await this.deps.settings.update({ liveTranscriptionEnabled: enabled });
    void this.publishStatus();
    return true;
  }

  /**
   * Turning the labels on without the model downloads it first. If that fails the setting stays
   * off and the failure is returned (B7).
   */
  async setSpeakerLabels(
    enabled: boolean,
  ): Promise<
    | { status: 'saved'; enabled: boolean }
    | { status: 'cancelled' }
    | { status: 'failed'; message: string }
  > {
    const current = await this.deps.settings.load();
    if (enabled && !this.deps.runtime.models.isDiarizationModelDownloaded()) {
      const outcome = await this.downloadSpeakerModel();
      if (outcome.status === 'cancelled') return { status: 'cancelled' };
      if (outcome.status === 'failed') return { status: 'failed', message: outcome.message };
    }
    if (current.speakerDiarizationEnabled !== enabled) {
      await this.deps.settings.update({ speakerDiarizationEnabled: enabled });
    }
    void this.publishStatus();
    return { status: 'saved', enabled };
  }

  downloadSpeakerModel(): Promise<InstallOutcomeDto> {
    if (this.install?.cancel.cancelled) {
      return this.install.done.then(() => this.downloadSpeakerModel());
    }
    if (this.install && this.install.kind !== 'speaker-model') {
      return this.install.done.then(() => this.downloadSpeakerModel());
    }
    if (this.install) return this.install.done;
    const cancel = new CancelSource();
    const done = this.runInstall(cancel, async () => {
      await this.deps.runtime.installer.ensureDiarizationModel((percent) => {
        this.reportProgress({ stage: 'speaker-model', percent, stepIndex: 0, stepCount: 1 });
      }, cancel.signal);
      return this.deps.runtime.models.isDiarizationModelDownloaded()
        ? { status: 'ready' }
        : { status: 'failed', message: this.deps.t('Error_EngineNotReady') };
    });
    this.install = { cancel, done, kind: 'speaker-model' };
    return done;
  }

  /** Removes the file and turns the labels off, so the page never promises labels it cannot make. */
  async deleteSpeakerModel(): Promise<
    { status: 'deleted' } | { status: 'failed'; message: string }
  > {
    try {
      await this.deps.runtime.models.deleteDiarizationModel();
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
    await this.deps.settings.update({ speakerDiarizationEnabled: false });
    void this.publishStatus();
    return { status: 'deleted' };
  }

  // -------------------------------------------------------------- live and offline

  /**
   * Starts the live pass for a take when Settings allows it and feeds it the mixed recording
   * frames. The recording module calls this after the capture has started.
   */
  async startLive(recordedAtMs: number | null): Promise<LiveStartResult> {
    const settings = await this.deps.settings.load();
    if (!settings.liveTranscriptionEnabled) return { active: false };
    const { live } = this.deps.runtime;
    this.lastDisplayText = '';
    this.unsubscribeUpdates?.();
    this.unsubscribeUpdates = live.onTranscriptUpdated((update) => {
      this.lastDisplayText = update.displayText;
      this.deps.broadcast(transcriptionLiveUpdate, update);
    });
    try {
      await live.start({
        language: resolveTranscriptionLanguage(settings),
        recordedAtMs,
        speakerDiarization: settings.speakerDiarizationEnabled,
      });
    } catch (error) {
      this.unsubscribeUpdates();
      this.unsubscribeUpdates = null;
      throw error;
    }
    this.unsubscribeFrames?.();
    this.unsubscribeFrames = this.deps.onRecordingFrames((pcm) => {
      live.pushFrame(pcm16ToFloat32(pcm), 16_000);
    });
    return { active: true };
  }

  /**
   * Ends the live pass and returns the draft. If stopping fails, the text on screen is the draft
   * (blank becomes null) so the take keeps something.
   */
  async stopLive(): Promise<string | null> {
    this.unsubscribeFrames?.();
    this.unsubscribeFrames = null;
    // Updates stay subscribed while Stop drains the queue, so the last text still reaches the pane.
    try {
      return await this.deps.runtime.live.stop();
    } catch (error) {
      this.deps.logger.warn('live transcription did not stop cleanly', { error: messageOf(error) });
      return this.lastDisplayText.trim() === '' ? null : this.lastDisplayText;
    } finally {
      this.unsubscribeUpdates?.();
      this.unsubscribeUpdates = null;
    }
  }

  /** The offline pass over a finished WAV, with the language and speaker labels from Settings. */
  async transcribeFile(run: OfflineRun): Promise<string> {
    const settings = await this.deps.settings.load();
    return this.deps.runtime.offline.transcribe({
      audioPath: run.audioPath,
      language: resolveTranscriptionLanguage(settings),
      recordedAtMs: run.recordedAtMs,
      speakerDiarization: settings.speakerDiarizationEnabled,
      ...(run.onProgress ? { onProgress: run.onProgress } : {}),
      ...(run.cancel ? { cancel: run.cancel } : {}),
    });
  }

  // ---------------------------------------------------------- re-transcription

  get retranscription(): MeetingRetranscriptionRunner['current'] {
    return this.runner.current;
  }

  async retranscriptionAvailability(meetingId: string): Promise<RetranscriptionAvailability> {
    const record = await this.deps.meetings.get(meetingId);
    return evaluateRetranscription(
      record,
      this.deps.busy.isBusy(meetingId) || this.runner.current.isRunning,
      this.deps.fileExists,
    );
  }

  /** Resolves when the run has ended; its result arrives as an event. */
  async startRetranscription(
    meetingId: string,
  ): Promise<
    | { started: true; reason: null }
    | { started: false; reason: 'NoAudio' | 'Busy' | 'AlreadyRunning' | 'NotFound' }
  > {
    const record = await this.deps.meetings.get(meetingId);
    if (record === null) return { started: false, reason: 'NotFound' };
    if (this.runner.current.isRunning) return { started: false, reason: 'AlreadyRunning' };
    const availability = evaluateRetranscription(
      record,
      this.deps.busy.isBusy(meetingId),
      this.deps.fileExists,
    );
    if (availability !== 'Available') return { started: false, reason: availability };
    void this.runner.start(record);
    return { started: true, reason: null };
  }

  cancelRetranscription(): void {
    this.runner.cancel();
  }

  /**
   * The part of the recording pipeline this module can run alone: the offline pass replaces the
   * transcript of the saved meeting, with the Ended header and the old stars. Until the offline
   * pass has text the saved transcript is untouched (spec 2.5). Summaries are the summary
   * module's, so a run ends as `TranscriptOnly`.
   */
  private pipeline(): RetranscriptionPipeline {
    return {
      run: async (request, callbacks, cancel) => {
        await this.replaceTranscript(request, callbacks, cancel);
      },
    };
  }

  private async replaceTranscript(
    request: RecordingPipelineRequest,
    callbacks: RetranscriptionPipelineCallbacks,
    cancel: CancelSignal,
  ): Promise<void> {
    const { t } = this.deps;
    if (!this.deps.runtime.installer.isReady()) {
      callbacks.onFinished(t('Error_EngineNotReady'));
      return;
    }
    const recordedAt = parseOffsetDate(request.recordedAt)?.ms ?? null;
    const endedAt =
      request.endedAt === null ? null : (parseOffsetDate(request.endedAt)?.ms ?? null);
    let text: string;
    try {
      text = await this.transcribeFile({
        audioPath: request.audioFilePath,
        recordedAtMs: recordedAt,
        cancel,
        onProgress: (percent) => {
          callbacks.onStatus(t('Status_TranscribingPercent', percent));
        },
      });
    } catch (error) {
      if (error instanceof TranscriptionCancelledError || cancel.cancelled) throw error;
      callbacks.onFinished(t('Error_TranscriptionFailedAudioKept', messageOf(error)));
      return;
    }
    if (text.trim() === '') {
      callbacks.onFinished(t('Error_NoTranscript'));
      return;
    }
    const current = await this.deps.meetings.get(request.meetingId);
    if (current === null) {
      callbacks.onFinished(t('Error_NoTranscript'));
      return;
    }
    const transcript = applyHighlights(
      ensureEndedHeader(text, recordedAt, endedAt),
      request.highlightsMs,
    );
    await this.deps.meetings.save({ ...current, transcript });
    callbacks.onMeetingSaved(request.meetingId);
  }
}
