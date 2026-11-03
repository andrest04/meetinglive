import type { ActionItem, MeetingRecord } from '../library/meeting';

/** The fields a summary run changes. Nothing else on the record is touched (B4). */
export interface SummaryPatch {
  readonly summary: string;
  readonly actionItems: readonly ActionItem[];
  readonly summaryProvider: string;
  readonly noteTemplateId: string | null;
  /** Null keeps the record's own title. */
  readonly title: string | null;
}

/** Lays a summary patch over a freshly read record, so edits made during the run survive. */
export function applySummaryPatch(record: MeetingRecord, patch: SummaryPatch): MeetingRecord {
  return {
    ...record,
    summary: patch.summary,
    actionItems: patch.actionItems.map((item) => ({ ...item })),
    summaryProvider: patch.summaryProvider,
    noteTemplateId: patch.noteTemplateId,
    title: patch.title ?? record.title,
  };
}
