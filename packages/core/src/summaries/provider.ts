import type { CancelSignal } from '../cancel';
import type { ActionItem } from '../library/meeting';
import type { OffsetDate } from '../library/offset-date';
import type { SummaryEnhancementContext } from './prompt-builders';
import { splitSummaryResponse } from './summary-splitter';

/** Spec 2.1. xAI is gone (S07), so only these three engines exist. */
export const PROVIDER_IDS = ['local', 'claude-code', 'codex'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface SummarizeRequest {
  readonly transcript: string;
  readonly title: string;
  readonly recordedAt: OffsetDate;
  readonly endedAt?: OffsetDate | null;
  /** Language code from settings. Blank or unknown means Spanish, as in the WinUI app. */
  readonly outputLanguage: string | null | undefined;
  readonly enhancement?: SummaryEnhancementContext | null;
}

export interface SuggestTitleRequest {
  readonly transcript: string;
  readonly recordedAt: OffsetDate;
  readonly outputLanguage: string | null | undefined;
}

/** What a prompt call tells its caller besides the text (B9). */
export interface PromptOutcome {
  /** The answer stopped because the output cap was reached, not because the model finished. */
  readonly truncated: boolean;
}

/** Optional extras for `completePrompt` and `streamPrompt`. Providers that have none ignore it. */
export interface PromptCallOptions {
  onOutcome?(outcome: PromptOutcome): void;
}

export interface SummaryResult {
  readonly summaryMarkdown: string;
  readonly actionItems: ActionItem[];
  readonly providerId: ProviderId;
  /** From the same response as the summary. There is never a second inference for it. */
  readonly suggestedTitle: string | null;
}

/**
 * The one port every engine implements. Providers build their prompt with the shared builders and
 * turn the reply into a result with `summaryResultFromResponse`, so nothing downstream branches on
 * the engine. Cancellation rejects with a `CancelledError` (see `isCancellation`).
 */
export interface SummaryProvider {
  readonly id: ProviderId;
  summarize(request: SummarizeRequest, cancel: CancelSignal): Promise<SummaryResult>;
  /** Raw model text. The caller runs `titleFromModelResponse`. */
  suggestTitle(request: SuggestTitleRequest, cancel: CancelSignal): Promise<string>;
  /** Raw model text for an already built prompt. */
  completePrompt(
    prompt: string,
    cancel: CancelSignal,
    options?: PromptCallOptions,
  ): Promise<string>;
  /** Text chunks whose concatenation equals the full answer. */
  streamPrompt(
    prompt: string,
    cancel: CancelSignal,
    options?: PromptCallOptions,
  ): AsyncIterable<string>;
}

/** The shared reply handling: split the three sections of the model text (S02). */
export function summaryResultFromResponse(providerId: ProviderId, raw: string): SummaryResult {
  const split = splitSummaryResponse(raw);
  return {
    summaryMarkdown: split.summaryMarkdown,
    actionItems: split.actionItems,
    providerId,
    suggestedTitle: split.suggestedTitle,
  };
}

/** Default `streamPrompt`: the whole `completePrompt` answer as one chunk (CLI providers). */
export function withDefaultStream(
  completePrompt: (prompt: string, cancel: CancelSignal) => Promise<string>,
): (prompt: string, cancel: CancelSignal) => AsyncIterable<string> {
  return async function* stream(prompt, cancel) {
    yield await completePrompt(prompt, cancel);
  };
}

/** Thrown when a cancel signal stops an operation. Never wrapped as a CLI failure. */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AbortError';
  }
}

export function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Throws `CancelledError` when the signal is already cancelled. */
export function throwIfCancelled(cancel: CancelSignal): void {
  if (cancel.cancelled) throw new CancelledError();
}
