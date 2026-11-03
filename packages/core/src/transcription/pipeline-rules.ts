/**
 * How the recording pipeline picks the transcript (spec 3.12). The pipeline is the recording
 * module's; the rule lives here because it is a rule about transcripts.
 */
export type TranscriptionStage =
  | 'OfflineTranscript'
  | 'LiveDraft'
  | 'LiveDraftAfterFailure'
  | 'NoTranscript'
  | 'FailedWithoutTranscript';

const blank = (text: string | null | undefined): boolean =>
  text === null || text === undefined || text.trim() === '';

export function resolveTranscriptionStage(
  liveDraft: string | null,
  offlineTranscript: string | null,
  offlinePassFailed: boolean,
): TranscriptionStage {
  if (!blank(offlineTranscript)) return 'OfflineTranscript';
  if (!blank(liveDraft)) return offlinePassFailed ? 'LiveDraftAfterFailure' : 'LiveDraft';
  return offlinePassFailed ? 'FailedWithoutTranscript' : 'NoTranscript';
}
