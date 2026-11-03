import type { CancelSignal } from '../cancel';
import type { Clock } from '../clock';
import type { TranslateFn } from '../i18n/translator';
import type { ActionItem } from '../library/meeting';
import { offsetDateFromInstant, parseOffsetDate, type OffsetDate } from '../library/offset-date';
import type { MeetingBusyProbe, MeetingRepository, SettingsStore } from '../library/ports';
import { resolveSummaryLanguage } from '../library/settings';
import { CliToolError, type CliFailureKind } from './cli-failure';
import { formatFailure, SummaryError, type SummaryErrorCode } from './cli-failure-messages';
import { applySummaryPatch } from './meeting-patch';
import { PatchQueue } from './patch-queue';
import { createEnhancementContext } from './prompt-builders';
import { isCancellation, type ProviderId } from './provider';
import type { SetupKind, SummaryProviderResolver } from './provider-resolver';
import {
  DEFAULT_PLACEHOLDER_FORMATS,
  placeholderPatternsFromFormats,
  resolveTitle,
} from './suggested-title';
import { resolveTemplateInstructions, templateIdToStore } from './template-instructions';

export interface GenerateRequest {
  readonly meetingId: string;
  /**
   * True when the user confirmed replacing an existing summary. The confirmation dialog belongs to
   * the UI; the service writes the new summary either way.
   */
  readonly regenerate: boolean;
  readonly cancel: CancelSignal;
  /** The picker's selection. Defaults to the template stored on the record. */
  readonly templateId?: string | null;
  /** The meeting agenda for the prompt. Only the recording pipeline has one. */
  readonly agenda?: string | null;
  /**
   * The recording pipeline holds the meeting busy for its own run, so it asks to skip the
   * external busy probe. Two runs of the same meeting are still refused.
   */
  readonly skipBusyProbe?: boolean;
}

/** A failure as plain data, so it can cross the IPC boundary. Text is built by `describeFailed`. */
export interface GenerateFailure {
  /** A `SummaryError` code, `Cli<Kind>` for a CLI failure, or `Unknown`. */
  readonly code: string;
  readonly args: readonly (string | number)[];
  /** Extra text from the tool (CLI `Unknown`) or the raw error message. */
  readonly detail: string | null;
}

export type GenerateOutcome =
  | {
      readonly status: 'generated';
      readonly title: string;
      readonly titleChanged: boolean;
      readonly summary: string;
      readonly actionItems: readonly ActionItem[];
      readonly providerId: ProviderId;
    }
  | { readonly status: 'no-transcript' }
  | { readonly status: 'not-found' }
  | { readonly status: 'busy' }
  /** The gate value (B34). The UI opens the dialogs; this is not an error. */
  | {
      readonly status: 'needs-setup';
      readonly kind: SetupKind;
      readonly reason: 'model-missing' | 'cli-missing';
    }
  | { readonly status: 'unavailable'; readonly reason: 'xai-removed' }
  | { readonly status: 'cancelled' }
  | ({ readonly status: 'failed' } & GenerateFailure);

export interface SummaryServiceDeps {
  readonly meetings: MeetingRepository;
  readonly settings: SettingsStore;
  readonly resolver: Pick<SummaryProviderResolver, 'resolveSummaryProvider'>;
  readonly clock: Clock;
  /** `MeetingChanged`: called when the title changed (items 31 and 32). */
  readonly notifyMeetingChanged: (meetingId: string) => void;
  /** Other modules' busy probe (recording or re-transcription of the same meeting). */
  readonly busy?: MeetingBusyProbe;
  /** Both locales' `MeetingTitleFormat` values, so an auto title in either language is replaced. */
  readonly placeholderFormats?: readonly string[];
  /** Shared with the tab service so a generate save and a tab save never interleave (B4, B5). */
  readonly queue?: PatchQueue;
}

export function failureFromError(error: unknown): GenerateFailure {
  if (error instanceof SummaryError) return { code: error.code, args: error.args, detail: null };
  if (error instanceof CliToolError) {
    return {
      code: `Cli${error.kind}`,
      args: [error.displayName],
      detail: error.kind === 'Unknown' ? error.detail : null,
    };
  }
  return {
    code: 'Unknown',
    args: [],
    detail: error instanceof Error ? error.message : String(error),
  };
}

/** The sentence for a failed outcome, in the locale of `translate` (spec 2.5, B28). */
export function describeFailed(failure: GenerateFailure, translate: TranslateFn): string {
  if (failure.code.startsWith('Cli')) {
    const kind = failure.code.slice(3) as CliFailureKind;
    return formatFailure(
      new CliToolError(String(failure.args[0] ?? ''), kind, failure.detail),
      translate,
    );
  }
  if (failure.code === 'Unknown') return failure.detail ?? '';
  return formatFailure(new SummaryError(failure.code as SummaryErrorCode, failure.args), translate);
}

/** Spec 2.2 Generate. One run per meeting at a time; every result is a value. */
export class SummaryService {
  private readonly inFlight = new Set<string>();
  private readonly patterns: RegExp[];

  private readonly queue: PatchQueue;

  constructor(private readonly deps: SummaryServiceDeps) {
    this.queue = deps.queue ?? new PatchQueue();
    this.patterns = placeholderPatternsFromFormats(
      deps.placeholderFormats ?? DEFAULT_PLACEHOLDER_FORMATS,
    );
  }

  isGenerating(meetingId: string): boolean {
    return this.inFlight.has(meetingId);
  }

  async generate(request: GenerateRequest): Promise<GenerateOutcome> {
    const { meetingId, cancel } = request;
    if (
      this.inFlight.has(meetingId) ||
      (request.skipBusyProbe !== true && this.deps.busy?.isBusy(meetingId) === true)
    ) {
      return { status: 'busy' };
    }
    this.inFlight.add(meetingId);
    try {
      return await this.run(request);
    } catch (error) {
      if (cancel.cancelled || isCancellation(error)) return { status: 'cancelled' };
      return { status: 'failed', ...failureFromError(error) };
    } finally {
      this.inFlight.delete(meetingId);
    }
  }

  private async run(request: GenerateRequest): Promise<GenerateOutcome> {
    const { meetingId, cancel } = request;
    // Loaded fresh: the page copy may be minutes old.
    const record = await this.deps.meetings.get(meetingId);
    if (record === null) return { status: 'not-found' };
    const transcript = record.transcript ?? '';
    if (transcript.trim() === '') return { status: 'no-transcript' };

    const gate = await this.deps.resolver.resolveSummaryProvider();
    if (gate.status === 'needs-setup') {
      return { status: 'needs-setup', kind: gate.kind, reason: gate.reason };
    }
    if (gate.status === 'unavailable') return { status: 'unavailable', reason: gate.reason };

    const settings = await this.deps.settings.load();
    const requested = request.templateId === undefined ? record.noteTemplateId : request.templateId;
    const enhancement = createEnhancementContext({
      rawNotes: record.notes,
      attendees: record.attendees,
      agenda: request.agenda ?? null,
      templateInstructions: resolveTemplateInstructions(requested),
    });
    const now = (): OffsetDate => offsetDateFromInstant(this.deps.clock.now());
    const dateOf = (text: string): OffsetDate => parseOffsetDate(text) ?? now();

    const result = await gate.provider.summarize(
      {
        transcript,
        title: record.title,
        recordedAt: dateOf(record.recordedAt),
        endedAt: record.endedAt === null ? null : dateOf(record.endedAt),
        outputLanguage: resolveSummaryLanguage(settings),
        enhancement: enhancement.hasAny ? enhancement : null,
      },
      cancel,
    );
    if (cancel.cancelled) return { status: 'cancelled' };

    // B4: the run can take minutes. Lay the result over the record as it is now.
    const outcome = await this.queue.run(meetingId, async () => {
      const fresh = await this.deps.meetings.get(meetingId);
      if (fresh === null) return null;
      const title = resolveTitle(fresh.title, result.suggestedTitle, this.patterns);
      const titleChanged = title !== fresh.title;
      const saved = await this.deps.meetings.save(
        applySummaryPatch(fresh, {
          summary: result.summaryMarkdown,
          actionItems: result.actionItems,
          summaryProvider: result.providerId,
          noteTemplateId: templateIdToStore(requested),
          title: titleChanged ? title : null,
        }),
      );
      return { saved, titleChanged };
    });
    if (outcome === null) return { status: 'not-found' };
    const { saved, titleChanged } = outcome;
    if (titleChanged) this.deps.notifyMeetingChanged(meetingId);
    return {
      status: 'generated',
      title: saved.title,
      titleChanged,
      summary: result.summaryMarkdown,
      actionItems: result.actionItems,
      providerId: result.providerId,
    };
  }
}
