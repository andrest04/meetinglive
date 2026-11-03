/**
 * What one take hands the pipeline (spec 3.7). It is built before the first await at Stop, so
 * nothing the user does next can leak into the take. Times are epoch milliseconds.
 */
export interface PipelineRequest {
  readonly meetingId: string;
  readonly audioPath: string;
  readonly recordedAtMs: number;
  /** Null when the end is unknown. */
  readonly endedAtMs: number | null;
  readonly title: string;
  /** The live transcript, or null so the offline pass becomes the transcript. */
  readonly liveDraft: string | null;
  /** The time the user paused, in milliseconds. Passed to the offline pass as clock skew. */
  readonly pausedDurationMs: number;
  readonly folderId: string | null;
  /** Elapsed milliseconds of the highlights marked during the take. */
  readonly highlightsMs: readonly number[];
  readonly agenda?: string | null;
  readonly noteTemplateId?: string | null;
  readonly templateInstructions?: string | null;
  /**
   * Kept only so frontmatter that already exists on disk survives a save (owner decision
   * 2026-11-03: the calendar features are not ported, the keys are still read and written).
   */
  readonly calendarEventId?: string | null;
  readonly calendarId?: string | null;
  readonly seriesId?: string | null;
  readonly joinUrl?: string | null;
  readonly attendees?: readonly string[];
  readonly brief?: string | null;
}
