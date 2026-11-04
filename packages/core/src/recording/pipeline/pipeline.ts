import type { CancelSignal } from '../../cancel';
import type { MeetingRecord } from '../../library/meeting';
import type { MeetingRepository, SettingsStore } from '../../library/ports';
import { resolveTranscriptionLanguage } from '../../library/settings';
import { isCancellation } from '../../summaries/provider';
import { TranscriptionCancelledError } from '../../transcription/ports';
import { ensureEndedHeader } from '../../transcription/stamp-format';
import type { Message } from '../recording-status';
import type { PipelineRequest } from './request';
import { resolveTranscriptionStage } from '../../transcription/pipeline-rules';
import { isBlankText, sameAudioPath, shouldSaveBeforeTranscribing } from './rules';
import { buildProcessedRecord, type ProcessedContent } from './save-record';
import type { SummaryStage, SummaryStageOutcome } from './summary-stage';

/** Port: the offline pass over a finished WAV. Adapter: the transcription controller. */
export interface OfflineTranscriber {
  isReady(): Promise<boolean> | boolean;
  transcribe(request: {
    readonly audioPath: string;
    readonly language: string;
    readonly recordedAtMs: number;
    /** Time the user paused, in milliseconds (the clock skew of the old app). */
    readonly clockSkewMs: number;
    readonly speakerDiarization: boolean;
    readonly onProgress: (percent: number) => void;
    readonly cancel: CancelSignal;
  }): Promise<string>;
}

/** Port: keeps the audio of a take that is replaced (B-3). Returns where it now lives. */
export interface PreviousAudioKeeper {
  keep(audioPath: string): Promise<string>;
}

/** The nine callbacks of spec 3.9 plus the notes. The run host (R4) implements them. */
export interface PipelineHost {
  readonly currentSessionNotes: string | null;
  onStatusChanged(status: Message): void;
  onTranscriptRefreshed(transcript: string): void;
  onMeetingSaved(record: MeetingRecord): void;
  onFinished(status: Message): void;
  onTitleResetAndFinished(status: Message): void;
  onMeetingCompleted(meetingId: string, status: Message): void;
  onSummaryFailedAfterTranscriptSaved(meetingId: string, status: Message): void;
  onSavedWithoutTranscript(meetingId: string, status: Message): void;
}

export interface RecordingPipelineDeps {
  readonly meetings: Pick<MeetingRepository, 'get' | 'save'>;
  readonly settings: Pick<SettingsStore, 'load'>;
  readonly transcriber: OfflineTranscriber;
  /** The text for `{0}` of a failure message. */
  readonly formatFailure: (error: unknown) => string;
  readonly previousAudio?: PreviousAudioKeeper;
  /** The summary stage (part 2). Without it a run ends at `transcript-saved`. */
  readonly summary?: SummaryStage;
}

export type PipelineOutcome =
  /** The transcript is saved. Part 2 (the summary stage) continues from here. */
  | {
      readonly kind: 'transcript-saved';
      readonly transcript: string;
      readonly record: MeetingRecord;
      readonly audioPath: string;
      /** Set when the live draft was kept because the offline pass failed. */
      readonly transcriptionWarning: Message | null;
      readonly previousAudioPath: string | null;
    }
  /** The host was told through `onSavedWithoutTranscript`; the audio is kept. */
  | {
      readonly kind: 'saved-without-transcript';
      readonly audioPath: string;
      readonly previousAudioPath: string | null;
    }
  /** The first save failed and there is no draft. The pipeline can be run again on this audio. */
  | { readonly kind: 'first-save-failed'; readonly audioPath: string; readonly message: Message }
  | { readonly kind: 'cancelled'; readonly transcriptSaved: boolean; readonly audioPath: string }
  /** Part 2 finished (completed, no provider, summary failed, summary cancelled). */
  | ({ readonly audioPath: string } & SummaryStageOutcome)
  /** Any other exception (spec 3.7 exception handling). The host was told. */
  | {
      readonly kind: 'failed';
      readonly transcriptSaved: boolean;
      readonly audioPath: string;
      readonly message: Message;
    };

const isCancelled = (error: unknown): boolean =>
  isCancellation(error) || error instanceof TranscriptionCancelledError;

const processError = (detail: string): Message => ({
  key: 'Error_ProcessRecording',
  args: [detail],
});

class RunState {
  transcript: string | null = null;
  /** The meeting as stored before this run. */
  existing: MeetingRecord | null = null;
  /** The latest stored record: the base of every later save. */
  base: MeetingRecord | null = null;
  durable = false;
  /** The transcript of this run is stored. */
  transcriptSaved = false;
  audioPath: string;
  previousAudioPath: string | null = null;
  /** True once the replaced WAV was kept or reported (B-3); a failed first save leaves it false. */
  previousHandled = false;

  constructor(
    readonly request: PipelineRequest,
    readonly host: PipelineHost,
  ) {
    this.audioPath = request.audioPath;
  }
}

/**
 * The first half of the post-recording pipeline (spec 3.7 steps 1 to 4): save first, run the
 * offline pass, choose the transcript, save it. The summary stage is part 2.
 */
export class RecordingPipeline {
  constructor(private readonly deps: RecordingPipelineDeps) {}

  async run(
    request: PipelineRequest,
    host: PipelineHost,
    cancel: CancelSignal,
  ): Promise<PipelineOutcome> {
    const state = new RunState(request, host);
    try {
      const saved = await this.part1(state, cancel);
      if (saved.kind !== 'transcript-saved' || this.deps.summary === undefined) return saved;
      const stage = await this.deps.summary.run(request, host, saved.transcriptionWarning, cancel);
      return { ...stage, audioPath: state.audioPath };
    } catch (error) {
      if (isCancelled(error)) return await this.onCancelled(state);
      return await this.onFailed(state, error);
    }
  }

  /**
   * The host-level guard (spec 3.7, item 150): never throws, an escaping exception becomes a
   * terminal status, and `complete` always runs.
   */
  async runGuarded(
    request: PipelineRequest,
    host: PipelineHost,
    cancel: CancelSignal,
    complete: () => void,
  ): Promise<PipelineOutcome> {
    try {
      return await this.run(request, host, cancel);
    } catch (error) {
      const message = processError(this.safeFormat(error));
      host.onFinished(message);
      return { kind: 'failed', transcriptSaved: false, audioPath: request.audioPath, message };
    } finally {
      complete();
    }
  }

  /** Cancels the summary that runs after the hand-off (B-21). False when none runs. */
  cancelBackgroundSummary(meetingId: string): boolean {
    return this.deps.summary?.cancelBackgroundSummary(meetingId) ?? false;
  }

  private safeFormat(error: unknown): string {
    try {
      return this.deps.formatFailure(error);
    } catch {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Any non-cancel exception (spec 3.7 exception handling). */
  private async onFailed(state: RunState, error: unknown): Promise<PipelineOutcome> {
    const { request, host } = state;
    const friendly = this.safeFormat(error);
    if (isBlankText(state.transcript)) state.transcript = this.draftOf(request);
    if (isBlankText(state.transcript)) {
      const message = processError(friendly);
      if (state.durable) host.onSavedWithoutTranscript(request.meetingId, message);
      else host.onFinished(message);
      return { kind: 'failed', transcriptSaved: false, audioPath: state.audioPath, message };
    }
    if (!state.transcriptSaved) {
      try {
        await this.saveTranscript(state);
      } catch (saveError) {
        // The store may be the cause. Report a terminal status so the host never stays busy.
        const message = processError(this.safeFormat(saveError));
        host.onFinished(message);
        return { kind: 'failed', transcriptSaved: false, audioPath: state.audioPath, message };
      }
    }
    const message: Message = { key: 'Status_TranscriptSavedSummaryFailed', args: [friendly] };
    host.onSummaryFailedAfterTranscriptSaved(request.meetingId, message);
    return { kind: 'failed', transcriptSaved: true, audioPath: state.audioPath, message };
  }

  private draftOf(request: PipelineRequest): string | null {
    const draft = request.liveDraft ?? '';
    return isBlankText(draft)
      ? null
      : ensureEndedHeader(draft, request.recordedAtMs, request.endedAtMs);
  }

  private async part1(state: RunState, cancel: CancelSignal): Promise<PipelineOutcome> {
    const { request, host } = state;
    state.transcript = this.draftOf(request);

    // 1. First save, before anything that can fail.
    const existing = await this.deps.meetings.get(request.meetingId);
    state.existing = existing;
    state.base = existing;
    if (
      shouldSaveBeforeTranscribing(
        request.liveDraft,
        existing?.audioFilePath ?? null,
        request.audioPath,
      )
    ) {
      const hasDraft = !isBlankText(state.transcript);
      try {
        await this.save(state, {
          transcript: hasDraft ? state.transcript : (existing?.transcript ?? null),
          summary: hasDraft ? null : (existing?.summary ?? null),
          actionItems: hasDraft ? [] : (existing?.actionItems ?? []),
          summaryProvider: hasDraft ? null : (existing?.summaryProvider ?? null),
        });
        state.durable = true;
        state.previousHandled = true;
        state.previousAudioPath = await this.keepPreviousAudio(existing, request.audioPath);
      } catch (error) {
        if (isCancelled(error)) throw error;
        if (!hasDraft) {
          const message = processError(this.deps.formatFailure(error));
          host.onFinished(message);
          return { kind: 'first-save-failed', audioPath: state.audioPath, message };
        }
        // With a draft the pipeline goes on; a later save may succeed.
      }
    }

    // 2. Settings.
    const settings = await this.deps.settings.load();
    const language = resolveTranscriptionLanguage(settings);

    // 3. Offline pass.
    let transcriptionWarning: Message | null = null;
    if (await this.deps.transcriber.isReady()) {
      host.onStatusChanged({ key: 'Status_Transcribing', args: [] });
      let offline: string | null = null;
      let failure: unknown = null;
      let failed = false;
      try {
        offline = await this.deps.transcriber.transcribe({
          audioPath: state.audioPath,
          language,
          recordedAtMs: request.recordedAtMs,
          clockSkewMs: request.pausedDurationMs,
          speakerDiarization: settings.speakerDiarizationEnabled,
          onProgress: (percent) => {
            host.onStatusChanged({ key: 'Status_TranscribingPercent', args: [String(percent)] });
          },
          cancel,
        });
      } catch (error) {
        if (isCancelled(error)) throw error;
        failed = true;
        failure = error;
      }
      const stage = resolveTranscriptionStage(state.transcript, offline, failed);
      const detail = failed ? this.deps.formatFailure(failure) : '';
      switch (stage) {
        case 'OfflineTranscript':
          state.transcript = ensureEndedHeader(
            offline ?? '',
            request.recordedAtMs,
            request.endedAtMs,
          );
          host.onTranscriptRefreshed(state.transcript);
          break;
        case 'LiveDraftAfterFailure':
          transcriptionWarning = { key: 'Status_LiveDraftKeptTranscriptionFailed', args: [detail] };
          break;
        case 'LiveDraft':
          break;
        case 'FailedWithoutTranscript':
          host.onSavedWithoutTranscript(request.meetingId, {
            key: 'Error_TranscriptionFailedAudioKept',
            args: [detail],
          });
          return this.withoutTranscript(state);
        case 'NoTranscript':
          host.onSavedWithoutTranscript(request.meetingId, { key: 'Error_NoTranscript', args: [] });
          return this.withoutTranscript(state);
      }
    } else if (isBlankText(state.transcript)) {
      host.onSavedWithoutTranscript(request.meetingId, {
        key: 'Ui_TranscriptionEngineUnavailable',
        args: [],
      });
      return this.withoutTranscript(state);
    }

    // 4. Save the transcript. A re-run keeps the old summary until the new one succeeds (B-7).
    if (cancel.cancelled) throw new TranscriptionCancelledError();
    const record = await this.saveTranscript(state);
    return {
      kind: 'transcript-saved',
      transcript: state.transcript ?? '',
      record,
      audioPath: state.audioPath,
      transcriptionWarning,
      previousAudioPath: state.previousAudioPath,
    };
  }

  private withoutTranscript(state: RunState): PipelineOutcome {
    return {
      kind: 'saved-without-transcript',
      audioPath: state.audioPath,
      previousAudioPath: state.previousAudioPath,
    };
  }

  /** Cancellation (spec 3.7 outer handling, transcript half). */
  private async onCancelled(state: RunState): Promise<PipelineOutcome> {
    const { request, host } = state;
    if (isBlankText(state.transcript)) state.transcript = this.draftOf(request);
    const cancelled: Message = { key: 'Status_ProcessingCancelled', args: [] };
    if (isBlankText(state.transcript)) {
      if (state.durable) host.onSavedWithoutTranscript(request.meetingId, cancelled);
      else host.onFinished(cancelled);
      return { kind: 'cancelled', transcriptSaved: false, audioPath: state.audioPath };
    }
    try {
      if (!state.transcriptSaved) await this.saveTranscript(state);
    } catch (error) {
      host.onFinished(processError(this.safeFormat(error)));
      return { kind: 'cancelled', transcriptSaved: false, audioPath: state.audioPath };
    }
    host.onTitleResetAndFinished({ key: 'Status_CancelledTranscriptSaved', args: [] });
    return { kind: 'cancelled', transcriptSaved: true, audioPath: state.audioPath };
  }

  private async saveTranscript(state: RunState): Promise<MeetingRecord> {
    const sameAudio =
      state.existing !== null &&
      sameAudioPath(state.existing.audioFilePath, state.request.audioPath);
    const keep = sameAudio ? state.base : null;
    const record = await this.save(state, {
      transcript: state.transcript,
      summary: keep?.summary ?? null,
      actionItems: keep?.actionItems ?? [],
      summaryProvider: keep?.summaryProvider ?? null,
    });
    state.durable = true;
    state.transcriptSaved = true;
    if (!state.previousHandled) {
      // B-3: the first save failed with a draft; this save repoints the record, so the old WAV is kept now.
      state.previousHandled = true;
      state.previousAudioPath = await this.keepPreviousAudio(
        state.existing,
        state.request.audioPath,
      );
    }
    return record;
  }

  /** One save. Later saves use the path and fields the repository returned (B-28, B-6). */
  private async save(
    state: RunState,
    content: Omit<ProcessedContent, 'sessionNotes' | 'audioPath'>,
  ): Promise<MeetingRecord> {
    const record = buildProcessedRecord(state.request, state.base, {
      ...content,
      sessionNotes: state.host.currentSessionNotes,
      audioPath: state.audioPath,
    });
    const saved = await this.deps.meetings.save(record);
    state.base = saved;
    state.audioPath = saved.audioFilePath;
    state.host.onMeetingSaved(saved);
    return saved;
  }

  /**
   * B-3: a new take that replaces a different WAV keeps the old one. It is renamed next to
   * itself when a keeper is wired; if that fails or there is none, the file stays where it is
   * and its path is reported, so nothing is orphaned silently.
   */
  private async keepPreviousAudio(
    existing: MeetingRecord | null,
    audioPath: string,
  ): Promise<string | null> {
    const previous = existing?.audioFilePath ?? '';
    if (previous.trim() === '' || sameAudioPath(previous, audioPath)) return null;
    if (this.deps.previousAudio === undefined) return previous;
    try {
      return await this.deps.previousAudio.keep(previous);
    } catch {
      return previous;
    }
  }
}
