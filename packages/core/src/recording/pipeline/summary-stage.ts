import { CancelSource, type CancelSignal } from '../../cancel';
import type { TranslateFn } from '../../i18n/translator';
import type { SettingsStore } from '../../library/ports';
import { CliToolError } from '../../summaries/cli-failure';
import { formatFailure } from '../../summaries/cli-failure-messages';
import type { SummaryProviderResolver } from '../../summaries/provider-resolver';
import {
  describeFailed,
  type GenerateOutcome,
  type SummaryService,
} from '../../summaries/summary-service';
import { TranscriptionCancelledError } from '../../transcription/ports';
import { parseSummaryProvider } from '../readiness';
import type { Message } from '../recording-status';
import type { PipelineHost } from './pipeline';
import type { PipelineRequest } from './request';

/**
 * The seam to the summaries module. `SummaryService.generate` is the one place that calls a
 * provider, resolves the title, saves the summary and tells the workspace; the pipeline never
 * calls a provider itself.
 */
export interface SummaryStageDeps {
  readonly settings: Pick<SettingsStore, 'load'>;
  readonly resolver: Pick<SummaryProviderResolver, 'resolveSummaryProvider'>;
  readonly generator: Pick<SummaryService, 'generate'>;
  readonly translate: TranslateFn;
}

export type SummaryStageOutcome =
  /** The summary is saved. */
  | { readonly kind: 'completed'; readonly titleChanged: boolean; readonly message: Message }
  /** No usable provider: the transcript stays, the take ends as done without a summary. */
  | { readonly kind: 'no-summary'; readonly message: Message }
  | { readonly kind: 'summary-failed'; readonly message: Message }
  /** The background summary was cancelled. The saved transcript is kept. */
  | { readonly kind: 'summary-cancelled'; readonly message: Message };

const DISPLAY_NAMES = { ClaudeCode: 'Claude Code', Codex: 'Codex' } as const;

/** Spec 3.7 steps 5 to 10. The transcript of the take is already saved when this runs. */
export class SummaryStage {
  /** The background summaries by meeting. Each has its own cancel source (B-21). */
  private readonly background = new Map<string, CancelSource>();

  constructor(private readonly deps: SummaryStageDeps) {}

  /** Cancels the summary that runs after the hand-off. Returns false when none runs. */
  cancelBackgroundSummary(meetingId: string): boolean {
    const source = this.background.get(meetingId);
    if (source === undefined) return false;
    source.cancel();
    return true;
  }

  isSummarizing(meetingId: string): boolean {
    return this.background.has(meetingId);
  }

  async run(
    request: PipelineRequest,
    host: PipelineHost,
    transcriptionWarning: Message | null,
    cancel: CancelSignal,
  ): Promise<SummaryStageOutcome> {
    // 5. Resolve the provider. A safety net: it never asks for a first-time choice.
    const settings = await this.deps.settings.load();
    const kind = parseSummaryProvider(settings.selectedSummaryProvider);
    const done = transcriptionWarning ?? { key: 'Status_DoneNoSummary', args: [] };
    const xaiRemoved: Message = { key: 'Ui_SummaryProviderXaiRemoved', args: [] };
    const none = (message: Message): SummaryStageOutcome => {
      host.onTitleResetAndFinished(message);
      return { kind: 'no-summary', message };
    };
    if (kind === null) return none(done);
    if (kind === 'Xai') return none(xaiRemoved);
    const resolution = await this.deps.resolver.resolveSummaryProvider({ kind });
    if (resolution.status === 'unavailable') return none(xaiRemoved);
    if (resolution.status === 'needs-setup') return none(done);
    if (cancel.cancelled) throw new TranscriptionCancelledError();

    // 6. Hand-off. The foreground session is released; the rest runs in the background.
    const own = new CancelSource();
    const stopWithRun = cancel.onCancel(() => {
      own.cancel();
    });
    this.background.set(request.meetingId, own);
    host.onTitleResetAndFinished({ key: 'Status_GeneratingSummary', args: [] });
    try {
      // 7 to 8. The notes are read now, after the hand-off, so late typing is included.
      const outcome = await this.deps.generator.generate({
        meetingId: request.meetingId,
        regenerate: true,
        cancel: own.signal,
        templateId: request.noteTemplateId ?? null,
        agenda: request.agenda ?? null,
        rawNotes: host.currentSessionNotes,
        ...(request.templateInstructions === undefined
          ? {}
          : { templateInstructions: request.templateInstructions }),
        skipBusyProbe: true,
      });
      return this.finish(request, host, outcome, transcriptionWarning, own.signal);
    } catch (error) {
      if (own.signal.cancelled) return this.cancelled(host);
      throw error;
    } finally {
      stopWithRun();
      if (this.background.get(request.meetingId) === own) this.background.delete(request.meetingId);
    }
  }

  private finish(
    request: PipelineRequest,
    host: PipelineHost,
    outcome: GenerateOutcome,
    transcriptionWarning: Message | null,
    cancel: CancelSignal,
  ): SummaryStageOutcome {
    if (outcome.status === 'cancelled' || cancel.cancelled) return this.cancelled(host);
    if (outcome.status === 'generated') {
      // 9. The Jev step is not ported (owner decision 2026-11-03); the saved Jev section stays.
      // 10. Completion.
      const message = transcriptionWarning ?? { key: 'Status_DoneWithSummary', args: [] };
      host.onMeetingCompleted(request.meetingId, message);
      return { kind: 'completed', titleChanged: outcome.titleChanged, message };
    }
    const message: Message = {
      key: 'Status_TranscriptSavedSummaryFailed',
      args: [this.describe(outcome)],
    };
    host.onSummaryFailedAfterTranscriptSaved(request.meetingId, message);
    return { kind: 'summary-failed', message };
  }

  private cancelled(host: PipelineHost): SummaryStageOutcome {
    const message: Message = { key: 'Status_CancelledTranscriptSaved', args: [] };
    host.onTitleResetAndFinished(message);
    return { kind: 'summary-cancelled', message };
  }

  /** The sentence for a summary that did not come out, in the locale of `translate`. */
  private describe(
    outcome: Exclude<GenerateOutcome, { status: 'generated' | 'cancelled' }>,
  ): string {
    const { translate: t } = this.deps;
    switch (outcome.status) {
      case 'failed':
        return describeFailed(outcome, t);
      case 'needs-setup':
        return outcome.reason === 'model-missing'
          ? t('Ui_SummaryLocalModelMissing')
          : formatFailure(
              new CliToolError(
                outcome.kind === 'Codex' ? DISPLAY_NAMES.Codex : DISPLAY_NAMES.ClaudeCode,
                'NotInstalled',
              ),
              t,
            );
      case 'unavailable':
        return t('Ui_SummaryProviderXaiRemoved');
      case 'busy':
        return t('Ui_SummaryMeetingBusy');
      case 'no-transcript':
        return t('Error_NoTranscript');
      case 'not-found':
        return t('Ui_SummaryMeetingGone');
    }
  }
}
