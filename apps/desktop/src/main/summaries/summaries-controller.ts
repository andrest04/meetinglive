import {
  summariesProgress,
  type EventChannel,
  type GenerateOutcomeDto,
  type PayloadInputOf,
  type SummaryCliKindDto,
} from '@vozella/contracts';
import {
  CancelSource,
  CliToolError,
  cliExecutableName,
  defaultModelFileName,
  describeFailed,
  findSummaryModel,
  formatFailure,
  resolveTemplateInstructions,
  type CancelSignal,
  type CliPathProbe,
  type GenerateOutcome,
  type HardwareProbe,
  type HardwareProfile,
  type LocalModelsService,
  type Logger,
  type RecordingPipelineRequest,
  type SettingsStore,
  type SummaryProviderResolver,
  type SummaryService,
  type SummaryTabService,
  type TranslateFn,
} from '@vozella/core';

export type Broadcast = <C extends EventChannel>(channel: C, payload: PayloadInputOf<C>) => void;

export interface SummariesControllerDeps {
  readonly service: Pick<SummaryService, 'generate' | 'isGenerating'>;
  readonly tab: Pick<
    SummaryTabService,
    'loadTab' | 'saveNotes' | 'toggleActionItem' | 'copyActionItems' | 'setTemplate'
  >;
  readonly resolver: Pick<SummaryProviderResolver, 'resolveSummaryProvider'>;
  readonly models: Pick<LocalModelsService, 'rows' | 'download' | 'cancel'>;
  readonly hardware: HardwareProbe;
  readonly cli: CliPathProbe;
  readonly settings: SettingsStore;
  /** Stops the local llama-server for good. Called on quit. */
  readonly runtime: { dispose(): Promise<void> };
  readonly broadcast: Broadcast;
  readonly logger: Logger;
  /** Looks a string up in the current app language at the moment of use. */
  readonly t: TranslateFn;
}

/** What the recording pipeline learns from the summary stage. */
export type PipelineSummaryResult =
  | { readonly status: 'completed' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

const HINT_KEYS = { ClaudeCode: 'Cli_ClaudeHint', Codex: 'Cli_CodexHint' } as const;
const DISPLAY_NAMES = { ClaudeCode: 'Claude Code', Codex: 'Codex' } as const;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What the Summary tab and the setup flow ask of the main process. It owns the cancel source of
 * each running generation (one per meeting), asks the services, and turns their values into the
 * wire shape. Nothing here throws to the page: a service that fails answers a `failed` value.
 */
export class SummariesController {
  private readonly running = new Map<string, CancelSource>();
  private disposed: Promise<void> | null = null;

  constructor(private readonly deps: SummariesControllerDeps) {}

  loadTab(meetingId: string | null) {
    return this.deps.tab.loadTab({ meetingId }).then((result) =>
      result.status === 'loaded'
        ? {
            status: 'loaded' as const,
            state: result.state,
            generating:
              result.state.meetingId !== null &&
              (this.running.has(result.state.meetingId) ||
                this.deps.service.isGenerating(result.state.meetingId)),
          }
        : result,
    );
  }

  saveNotes(meetingId: string, text: string) {
    return this.deps.tab.saveNotes(meetingId, text);
  }

  toggleAction(meetingId: string, index: number, done: boolean) {
    return this.deps.tab.toggleActionItem(meetingId, index, done);
  }

  copyActions(meetingId: string) {
    return this.deps.tab.copyActionItems(meetingId);
  }

  setTemplate(meetingId: string, templateId: string | null) {
    return this.deps.tab.setTemplate(meetingId, templateId);
  }

  // ------------------------------------------------------------- generation

  /** One run per meeting: a second request answers `busy` and leaves the first one alone. */
  async generate(request: {
    readonly meetingId: string;
    readonly regenerate: boolean;
    readonly templateId?: string | null;
  }): Promise<GenerateOutcomeDto> {
    const { meetingId } = request;
    if (this.running.has(meetingId) || this.disposed !== null) return { status: 'busy' };
    const source = new CancelSource();
    this.running.set(meetingId, source);
    this.announce(meetingId, true);
    try {
      const outcome = await this.deps.service.generate({
        meetingId,
        regenerate: request.regenerate,
        cancel: source.signal,
        ...(request.templateId === undefined ? {} : { templateId: request.templateId }),
      });
      return this.toDto(outcome);
    } catch (error) {
      // The service answers values; this guards a bug, not a normal outcome.
      this.deps.logger.error('summary generation threw', { error });
      return this.failedDto(messageOf(error));
    } finally {
      this.running.delete(meetingId);
      this.announce(meetingId, false);
    }
  }

  cancel(meetingId: string): boolean {
    const source = this.running.get(meetingId);
    if (source === undefined) return false;
    source.cancel();
    return true;
  }

  /**
   * The summary stage of the recording pipeline and of re-transcription: the same generate core,
   * with the meeting agenda and the template text of the request. The pipeline holds the meeting
   * busy itself, so the busy probe is skipped; a run for the same meeting is still refused.
   */
  async summarizeForPipeline(
    request: RecordingPipelineRequest,
    cancel: CancelSignal,
  ): Promise<PipelineSummaryResult> {
    const { meetingId } = request;
    this.announce(meetingId, true);
    try {
      const outcome = await this.deps.service.generate({
        meetingId,
        regenerate: true,
        cancel,
        templateId: request.noteTemplateId,
        agenda: request.agenda,
        skipBusyProbe: true,
      });
      return this.pipelineResult(outcome);
    } catch (error) {
      return cancel.cancelled
        ? { status: 'cancelled' }
        : { status: 'failed', message: this.formatError(error) };
    } finally {
      this.announce(meetingId, false);
    }
  }

  /** The template text for a record, for the re-transcription request. */
  templateInstructions(record: { readonly noteTemplateId: string | null }): Promise<string | null> {
    return Promise.resolve(resolveTemplateInstructions(record.noteTemplateId));
  }

  /** The sentence for any failure of the summary stage (S03 `formatFailure`). */
  formatError(error: unknown): string {
    if (error instanceof CliToolError) return formatFailure(error, this.deps.t);
    return messageOf(error);
  }

  private pipelineResult(outcome: GenerateOutcome): PipelineSummaryResult {
    const { t } = this.deps;
    switch (outcome.status) {
      case 'generated':
        return { status: 'completed' };
      case 'cancelled':
        return { status: 'cancelled' };
      case 'failed':
        return { status: 'failed', message: describeFailed(outcome, t) };
      case 'needs-setup':
        return {
          status: 'failed',
          message:
            outcome.reason === 'model-missing'
              ? t('Ui_SummaryLocalModelMissing')
              : formatFailure(
                  new CliToolError(
                    outcome.kind === 'Codex' ? DISPLAY_NAMES.Codex : DISPLAY_NAMES.ClaudeCode,
                    'NotInstalled',
                  ),
                  t,
                ),
        };
      case 'unavailable':
        return { status: 'failed', message: t('Ui_SummaryProviderXaiRemoved') };
      case 'busy':
        return { status: 'failed', message: t('Ui_SummaryMeetingBusy') };
      case 'no-transcript':
        return { status: 'failed', message: t('Error_NoTranscript') };
      case 'not-found':
        return { status: 'failed', message: t('Ui_SummaryMeetingGone') };
    }
  }

  private toDto(outcome: GenerateOutcome): GenerateOutcomeDto {
    if (outcome.status !== 'failed') return outcome;
    return { ...outcome, message: describeFailed(outcome, this.deps.t) };
  }

  private failedDto(detail: string): GenerateOutcomeDto {
    return { status: 'failed', code: 'Unknown', args: [], detail, message: detail };
  }

  private announce(meetingId: string, running: boolean): void {
    this.deps.broadcast(summariesProgress, { meetingId, running });
  }

  // ------------------------------------------------------------- setup flow

  async providerStatus() {
    const gate = await this.deps.resolver.resolveSummaryProvider();
    if (gate.status === 'ready') return { status: 'ready' as const, kind: gate.kind };
    if (gate.status === 'needs-setup') {
      return { status: 'needs-setup' as const, kind: gate.kind, reason: gate.reason };
    }
    return { status: 'unavailable' as const, reason: gate.reason };
  }

  /** The wizard's model step. A machine that cannot be read just has no fit badges. */
  async hardwareOptions() {
    const hardware: HardwareProfile | null = await this.deps.hardware.detect().catch(() => null);
    const { rows } = await this.deps.models.rows(hardware);
    return { hardware, rows, defaultFileName: defaultModelFileName(rows) };
  }

  async checkCli(kind: SummaryCliKindDto) {
    return {
      found: await this.deps.cli.isOnPath(cliExecutableName(kind)),
      executable: cliExecutableName(kind),
      hintKey: HINT_KEYS[kind],
    };
  }

  /**
   * Downloads the model when it is not on disk (joining a download already running), then saves
   * the model and the Local provider in one settings write. A cancel or a failed download saves
   * nothing.
   */
  async chooseLocalModel(fileName: string) {
    if (findSummaryModel(fileName) === null) {
      return { status: 'ignored' as const, reason: 'unknown-model' as const };
    }
    const outcome = await this.deps.models.download(fileName);
    if (outcome.status === 'failed') return outcome;
    if (outcome.status === 'cancelled') return outcome;
    if (outcome.status === 'ignored' && outcome.reason === 'unknown-model') {
      return { status: 'ignored' as const, reason: 'unknown-model' as const };
    }
    try {
      const settings = await this.deps.settings.update({
        selectedSummaryModelId: fileName,
        selectedSummaryProvider: 'Local',
      });
      return { status: 'saved' as const, settings };
    } catch (error) {
      return { status: 'failed' as const, message: messageOf(error) };
    }
  }

  cancelLocalModel(fileName: string): void {
    this.deps.models.cancel(fileName);
  }

  async chooseCli(kind: SummaryCliKindDto) {
    const executable = cliExecutableName(kind);
    try {
      if (!(await this.deps.cli.isOnPath(executable))) {
        return { status: 'not-found' as const, executable, hintKey: HINT_KEYS[kind] };
      }
      const settings = await this.deps.settings.update({ selectedSummaryProvider: kind });
      return { status: 'saved' as const, settings };
    } catch (error) {
      return { status: 'failed' as const, message: messageOf(error) };
    }
  }

  // ------------------------------------------------------------------ quit

  /** Cancels every run and stops the local server. Safe to call twice. */
  dispose(): Promise<void> {
    this.disposed ??= (async () => {
      for (const source of this.running.values()) source.cancel();
      await this.deps.runtime.dispose();
    })().catch((error: unknown) => {
      this.deps.logger.error('summary runtime dispose failed', { error });
    });
    return this.disposed;
  }
}
