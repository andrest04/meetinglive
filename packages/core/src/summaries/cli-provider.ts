import type { CancelSignal } from '../cancel';
import { runRequiredStdout, type CliProcessRunner } from './cli-failure';
import { buildSummaryPrompt, buildTitlePrompt } from './prompt-builders';
import {
  summaryResultFromResponse,
  withDefaultStream,
  type ProviderId,
  type SuggestTitleRequest,
  type SummarizeRequest,
  type SummaryProvider,
  type SummaryResult,
} from './provider';

/** Spec 3.7 and B31: five minutes, kept for parity. Callers may inject another value. */
export const CLI_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The base of the CLI providers (`CliToolProviderBase`): four values (executable, timeout, argv,
 * display name) and one way to run. The prompt goes to stdin, the answer is the trimmed stdout.
 * Prompts are sent whole; there is no chunking for CLI providers (B31, recorded in the ledger).
 */
export abstract class CliToolProvider implements SummaryProvider {
  abstract readonly id: ProviderId;
  protected abstract readonly executable: string;
  protected abstract readonly displayName: string;

  protected constructor(
    private readonly runner: CliProcessRunner,
    private readonly timeoutMs: number = CLI_TIMEOUT_MS,
  ) {}

  /** Built per call so a bad stored model or effort fails before anything is started. */
  protected abstract buildArgs(): readonly string[];

  async summarize(request: SummarizeRequest, cancel: CancelSignal): Promise<SummaryResult> {
    const raw = await this.run(buildSummaryPrompt(request), cancel);
    return summaryResultFromResponse(this.id, raw);
  }

  suggestTitle(request: SuggestTitleRequest, cancel: CancelSignal): Promise<string> {
    return this.run(
      buildTitlePrompt(request.transcript, request.recordedAt, request.outputLanguage),
      cancel,
    );
  }

  completePrompt(prompt: string, cancel: CancelSignal): Promise<string> {
    return this.run(prompt, cancel);
  }

  streamPrompt(prompt: string, cancel: CancelSignal): AsyncIterable<string> {
    return withDefaultStream((p, c) => this.completePrompt(p, c))(prompt, cancel);
  }

  private async run(prompt: string, cancel: CancelSignal): Promise<string> {
    return await runRequiredStdout(
      this.runner,
      this.executable,
      this.buildArgs(),
      prompt,
      this.timeoutMs,
      this.displayName,
      cancel,
    );
  }
}
