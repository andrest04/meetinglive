import type { TranslateFn } from '../i18n/translator';
import type { ActionItem, MeetingRecord } from '../library/meeting';
import type { MeetingRepository } from '../library/ports';
import { noteTemplateOptions } from '../settings/note-templates';
import { renderActionItems } from './action-items';
import { summaryFromAnswer, type SummaryContent } from './answer-to-summary';
import { templateIdToStore } from './template-instructions';
import { PatchQueue } from './patch-queue';
import {
  findRelated,
  instantOf,
  type RelatedCandidate,
  type RelatedMeetingItem,
} from './related-meetings';
import { deriveTabFlags, type TabState } from './tab-state';

export type CopyMode = 'notes' | 'summary';

/** Notes or summary for the session-level copy command; null when blank (item 104). */
export function copyTextFor(
  mode: CopyMode,
  source: { readonly notes: string | null; readonly summary: string | null },
): string | null {
  const text = mode === 'notes' ? source.notes : source.summary;
  return text === null || text.trim() === '' ? null : text;
}

export type TabLoadResult =
  | { readonly status: 'loaded'; readonly state: TabState }
  | { readonly status: 'failed'; readonly detail: string };

export type SaveNotesResult =
  | { readonly status: 'saved' | 'unchanged' | 'not-found' }
  | { readonly status: 'failed'; readonly detail: string };

export type ToggleResult =
  | { readonly status: 'saved'; readonly actionItems: readonly ActionItem[] }
  | { readonly status: 'not-found' | 'out-of-range' }
  /** `message` is the localized `Error_SaveActionItem` sentence for the status line. */
  | { readonly status: 'failed'; readonly message: string; readonly detail: string };

export type SetTemplateResult =
  | { readonly status: 'saved' | 'unchanged' | 'not-found' }
  | { readonly status: 'failed'; readonly detail: string };

export type ReplaceSummaryRequest =
  | { readonly kind: 'answer'; readonly text: string }
  | {
      readonly kind: 'restore';
      readonly summary: string | null;
      readonly actionItems: readonly ActionItem[];
    };

export type ReplaceSummaryResult =
  | { readonly status: 'saved'; readonly previous: SummaryContent }
  /** The answer left nothing to save. */
  | { readonly status: 'empty' | 'not-found' }
  | { readonly status: 'failed'; readonly detail: string };

export type CopyActionItemsResult =
  /** `message` is `SummaryPage_NoActionItems`; the UI shows it as an error draft message. */
  | { readonly status: 'empty'; readonly message: string }
  | { readonly status: 'copied'; readonly text: string }
  | { readonly status: 'not-found' };

export interface SummaryTabServiceDeps {
  readonly meetings: MeetingRepository;
  readonly translate: TranslateFn;
  /** The workspace's selected meeting id. */
  readonly getSelectedMeetingId: () => string | null;
  /** Tells the workspace to select the loaded meeting (item 79). */
  readonly selectMeeting: (id: string) => void;
  /** Shared with other writers of the same meeting so their patches stay ordered. */
  readonly queue?: PatchQueue;
}

interface ListedMeeting {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Spec 2.2 as a service the renderer drives over IPC. Every method returns a value. */
export class SummaryTabService {
  private readonly queue: PatchQueue;

  constructor(private readonly deps: SummaryTabServiceDeps) {
    this.queue = deps.queue ?? new PatchQueue();
  }

  /** Items 78 to 81. Given id, else the workspace selection, else the most recent meeting. */
  async loadTab(request: { readonly meetingId: string | null }): Promise<TabLoadResult> {
    try {
      const id = request.meetingId ?? this.deps.getSelectedMeetingId();
      let record: MeetingRecord | null = null;
      let listed: ListedMeeting[] | null = null;
      if (id !== null) {
        record = await this.deps.meetings.get(id);
      } else {
        listed = [...(await this.deps.meetings.list()).items];
        const latest = mostRecent(listed);
        if (latest !== null) record = await this.deps.meetings.get(latest.id);
      }
      let related: RelatedMeetingItem[] = [];
      if (record !== null) {
        this.deps.selectMeeting(record.id);
        related = await this.relatedFor(record, listed);
      }
      return { status: 'loaded', state: this.stateOf(record, related) };
    } catch (error) {
      return { status: 'failed', detail: errorText(error) };
    }
  }

  private stateOf(record: MeetingRecord | null, related: RelatedMeetingItem[]): TabState {
    const summary = record?.summary ?? '';
    const flags = deriveTabFlags({
      hasMeeting: record !== null,
      summary,
      transcript: record?.transcript ?? null,
      isShowingNotes: false,
      isLoading: false,
      isGenerating: false,
    });
    const templateId = (record?.noteTemplateId ?? '').trim();
    return {
      meetingId: record?.id ?? null,
      hasMeeting: record !== null,
      title: record === null ? this.deps.translate('NoSummariesYet') : record.title,
      notes: record?.notes ?? '',
      summary,
      actionItems: record === null ? [] : record.actionItems.map((item) => ({ ...item })),
      noteTemplateId: templateId === '' ? 'auto' : templateId,
      templates: noteTemplateOptions(null),
      related,
      flags,
      hasTranscript: (record?.transcript ?? '').trim() !== '',
    };
  }

  /**
   * The list carries no series id, so a record is only read when the current one has a series
   * and the meeting does not already match by title. A read that fails skips that meeting.
   */
  private async relatedFor(
    record: MeetingRecord,
    alreadyListed: ListedMeeting[] | null,
  ): Promise<RelatedMeetingItem[]> {
    try {
      const items = alreadyListed ?? [...(await this.deps.meetings.list()).items];
      const title = record.title.trim();
      const hasSeries = (record.seriesId ?? '').trim() !== '';
      const candidates = await Promise.all(
        items.map(async (item): Promise<RelatedCandidate> => {
          const base = { id: item.id, title: item.title, recordedAt: item.recordedAt };
          if (!hasSeries || item.id === record.id || item.title.trim() === title) {
            return { ...base, seriesId: null };
          }
          try {
            const other = await this.deps.meetings.get(item.id);
            return { ...base, seriesId: other?.seriesId ?? null };
          } catch {
            return { ...base, seriesId: null };
          }
        }),
      );
      return findRelated(record, candidates);
    } catch {
      return [];
    }
  }

  /** Item 102: re-read, blank becomes null, skip the write when unchanged, field patch only. */
  saveNotes(meetingId: string, text: string): Promise<SaveNotesResult> {
    return this.queue
      .run(meetingId, async (): Promise<SaveNotesResult> => {
        const fresh = await this.deps.meetings.get(meetingId);
        if (fresh === null) return { status: 'not-found' };
        const notes = text.trim() === '' ? null : text;
        if (notes === fresh.notes) return { status: 'unchanged' };
        await this.deps.meetings.save({ ...fresh, notes });
        return { status: 'saved' };
      })
      .catch((error: unknown): SaveNotesResult => ({ status: 'failed', detail: errorText(error) }));
  }

  /** Item 98 and B5: saves are queued per meeting, each on a freshly read record. */
  toggleActionItem(meetingId: string, index: number, done: boolean): Promise<ToggleResult> {
    return this.queue
      .run(meetingId, async (): Promise<ToggleResult> => {
        const fresh = await this.deps.meetings.get(meetingId);
        if (fresh === null) return { status: 'not-found' };
        if (!Number.isInteger(index) || index < 0 || index >= fresh.actionItems.length) {
          return { status: 'out-of-range' };
        }
        const actionItems = fresh.actionItems.map((item, i) =>
          i === index ? { ...item, isDone: done } : { ...item },
        );
        await this.deps.meetings.save({ ...fresh, actionItems });
        return { status: 'saved', actionItems };
      })
      .catch((error: unknown): ToggleResult => {
        const detail = errorText(error);
        return {
          status: 'failed',
          message: this.deps.translate('Error_SaveActionItem', detail),
          detail,
        };
      });
  }

  /**
   * Remembers the picker's choice on the record. Only a built-in template is stored; `auto` and
   * unknown ids clear it, as a generate does. Queued with the other writes (B5).
   */
  setTemplate(meetingId: string, templateId: string | null): Promise<SetTemplateResult> {
    return this.queue
      .run(meetingId, async (): Promise<SetTemplateResult> => {
        const fresh = await this.deps.meetings.get(meetingId);
        if (fresh === null) return { status: 'not-found' };
        const stored = templateIdToStore(templateId);
        if (stored === (fresh.noteTemplateId ?? null)) return { status: 'unchanged' };
        await this.deps.meetings.save({ ...fresh, noteTemplateId: stored });
        return { status: 'saved' };
      })
      .catch((error: unknown): SetTemplateResult => ({
        status: 'failed',
        detail: errorText(error),
      }));
  }

  /**
   * T4: replaces the summary and action items with a chat answer, or puts back what an earlier
   * replace returned (undo). Answers the previous content so the caller can offer the undo.
   * Queued with the other writes (B5); every other field of the record stays.
   */
  replaceSummary(meetingId: string, request: ReplaceSummaryRequest): Promise<ReplaceSummaryResult> {
    return this.queue
      .run(meetingId, async (): Promise<ReplaceSummaryResult> => {
        const fresh = await this.deps.meetings.get(meetingId);
        if (fresh === null) return { status: 'not-found' };
        const previous: SummaryContent = {
          summary: fresh.summary,
          actionItems: fresh.actionItems.map((item) => ({ ...item })),
        };
        const next =
          request.kind === 'answer'
            ? summaryFromAnswer(request.text, previous)
            : {
                summary: request.summary,
                actionItems: request.actionItems.map((item) => ({ ...item })),
              };
        if (next === null) return { status: 'empty' };
        await this.deps.meetings.save({
          ...fresh,
          summary: next.summary,
          actionItems: next.actionItems,
        });
        return { status: 'saved', previous };
      })
      .catch((error: unknown): ReplaceSummaryResult => ({
        status: 'failed',
        detail: errorText(error),
      }));
  }

  /** Item 99. The clipboard write belongs to the shell. */
  async copyActionItems(meetingId: string): Promise<CopyActionItemsResult> {
    try {
      const record = await this.deps.meetings.get(meetingId);
      if (record === null) return { status: 'not-found' };
      if (record.actionItems.length === 0) {
        return { status: 'empty', message: this.deps.translate('SummaryPage_NoActionItems') };
      }
      return { status: 'copied', text: renderActionItems(record.actionItems).replace(/\n+$/, '') };
    } catch {
      return { status: 'not-found' };
    }
  }

  /** Item 104 for a stored meeting; the Copy button on the Summary tab calls it through `summaries.copyText`. */
  async copyText(meetingId: string, mode: CopyMode): Promise<string | null> {
    try {
      const record = await this.deps.meetings.get(meetingId);
      return record === null ? null : copyTextFor(mode, record);
    } catch {
      return null;
    }
  }
}

function mostRecent(items: readonly ListedMeeting[]): ListedMeeting | null {
  let best: ListedMeeting | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const at = instantOf(item.recordedAt);
    if (best === null || at > bestAt) {
      best = item;
      bestAt = at;
    }
  }
  return best;
}
