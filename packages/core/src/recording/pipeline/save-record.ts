import type { ActionItem, MeetingRecord } from '../../library/meeting';
import {
  formatOffsetDate,
  offsetDateFromInstant,
  parseOffsetDate,
} from '../../library/offset-date';
import { applyHighlights } from '../../transcription/highlights';
import { ensureEndedHeader } from '../../transcription/stamp-format';
import { isBlankText } from './rules';
import type { PipelineRequest } from './request';

/** What differs from save to save. Everything else comes from the request or the stored record. */
export interface ProcessedContent {
  readonly transcript: string | null;
  readonly summary: string | null;
  readonly actionItems: readonly ActionItem[];
  readonly summaryProvider: string | null;
  /** The session notes the host holds right now. */
  readonly sessionNotes: string | null;
  /** The audio path as the repository last returned it (B-28). */
  readonly audioPath: string;
}

const trimmedOrNull = (text: string | null | undefined): string | null =>
  isBlankText(text) ? null : (text ?? '').trim();

const roundTrip = (ms: number): string =>
  formatOffsetDate(offsetDateFromInstant(new Date(ms)), 'round-trip');

/** Keeps the stored text when it names the same instant, so its offset and fraction survive. */
function dateText(stored: string | undefined, ms: number): string {
  if (stored !== undefined) {
    const parsed = parseOffsetDate(stored);
    if (parsed?.ms === ms) return stored;
  }
  return roundTrip(ms);
}

/**
 * The record every save writes (spec 3.7). `base` is the stored meeting, if any: fields the
 * request does not carry come from it, so a save never drops notes, attendees, calendar ids,
 * the template, Jev results, follow-up or project plan (B-6).
 */
export function buildProcessedRecord(
  request: PipelineRequest,
  base: MeetingRecord | null,
  content: ProcessedContent,
): MeetingRecord {
  const transcript = content.transcript ?? '';
  const stamped = isBlankText(transcript)
    ? null
    : ensureEndedHeader(transcript, request.recordedAtMs, request.endedAtMs);
  const attendees = (request.attendees ?? []).map((a) => a.trim()).filter((a) => a !== '');
  return {
    id: request.meetingId,
    title: request.title,
    recordedAt: dateText(base?.recordedAt, request.recordedAtMs),
    endedAt:
      request.endedAtMs === null ? null : dateText(base?.endedAt ?? undefined, request.endedAtMs),
    audioFilePath: content.audioPath,
    sourcePath: base?.sourcePath ?? null,
    folderId: request.folderId,
    summaryProvider: content.summaryProvider,
    calendarEventId: trimmedOrNull(request.calendarEventId) ?? base?.calendarEventId ?? null,
    calendarId: trimmedOrNull(request.calendarId) ?? base?.calendarId ?? null,
    seriesId: trimmedOrNull(request.seriesId) ?? base?.seriesId ?? null,
    joinUrl: trimmedOrNull(request.joinUrl) ?? base?.joinUrl ?? null,
    noteTemplateId: trimmedOrNull(request.noteTemplateId) ?? base?.noteTemplateId ?? null,
    attendees: attendees.length > 0 ? attendees : (base?.attendees ?? []),
    brief: trimmedOrNull(request.brief) ?? base?.brief ?? null,
    transcript: stamped === null ? null : applyHighlights(stamped, request.highlightsMs),
    summary: content.summary,
    actionItems: content.actionItems,
    jevAnalysis: base?.jevAnalysis ?? null,
    notes: trimmedOrNull(content.sessionNotes) ?? base?.notes ?? null,
    followUp: base?.followUp ?? null,
    projectPlan: base?.projectPlan ?? null,
  };
}
