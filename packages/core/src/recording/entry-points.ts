import { parseOffsetDate } from '../library/offset-date';
import type { RecordingPipelineRequest } from '../transcription/retranscription';
import type { PipelineRequest } from './pipeline/request';

/**
 * The calls other modules make into the recording module (session views, the shell, the pill).
 * The main process implements them in `main/recording/entry-points.ts`.
 */
export interface StartRecordingOptions {
  readonly title?: string;
  readonly folderId?: string | null;
  /** A meeting the take re-records. */
  readonly meetingId?: string | null;
}

export type ProcessAudioRequest = Omit<PipelineRequest, 'meetingId' | 'audioPath'>;

export type ProcessAudioResult =
  | { readonly started: true; readonly meetingId: string }
  | { readonly started: false; readonly reason: 'busy' };

export interface RecordingEntryPoints {
  startRecording(
    options?: StartRecordingOptions,
  ): Promise<{ started: boolean; meetingId: string | null }>;
  stopRecording(): Promise<boolean>;
  isCaptureActive(): boolean;
  isMeetingInUse(meetingId: string): boolean;
  /** Runs the pipeline on an audio file: a re-transcription (id given) or a new meeting (null). */
  processAudioFile(
    meetingId: string | null,
    audioPath: string,
    request: ProcessAudioRequest,
  ): ProcessAudioResult;
}

/**
 * Adapts the request the re-transcription module builds (ISO dates, a missing end is unknown) to
 * the pipeline's epoch-millisecond request. An unreadable start falls back to `fallbackMs`.
 */
export function pipelineRequestFromRetranscription(
  request: RecordingPipelineRequest,
  fallbackMs: number,
): { audioPath: string; request: PipelineRequest } {
  const recordedAtMs = parseOffsetDate(request.recordedAt)?.ms ?? fallbackMs;
  const endedAtMs =
    request.endedAt === null ? null : (parseOffsetDate(request.endedAt)?.ms ?? null);
  return {
    audioPath: request.audioFilePath,
    request: {
      meetingId: request.meetingId,
      audioPath: request.audioFilePath,
      recordedAtMs,
      endedAtMs,
      title: request.title,
      liveDraft: null,
      pausedDurationMs: Math.round(request.pausedSeconds * 1000),
      folderId: request.folderId,
      highlightsMs: request.highlightsMs,
      agenda: request.agenda,
      noteTemplateId: request.noteTemplateId,
      templateInstructions: request.templateInstructions,
      calendarEventId: request.calendarEventId,
      calendarId: request.calendarId,
      seriesId: request.seriesId,
      joinUrl: request.joinUrl,
      attendees: request.attendees,
      brief: request.brief,
    },
  };
}
