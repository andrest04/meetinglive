import type { TranslateFn } from '../i18n/translator';
import { formatFailure } from '../summaries/cli-failure-messages';

export { isCancellation } from '../summaries/provider';

/** Why a send produced no answer. The cancelled send has no kind: it is silent. */
export type ChatFailureKind =
  'setup-cancelled' | 'empty-answer' | 'send-failed' | 'provider-removed';

export interface ChatFailure {
  readonly kind: ChatFailureKind;
  /** The sentence to show, already in the language of the translator. */
  readonly message: string;
}

/** `Status_SetupCancelled` has no "Could not answer" prefix (spec 2.4 step 8). */
export function setupCancelledFailure(t: TranslateFn): ChatFailure {
  return { kind: 'setup-cancelled', message: t('Status_SetupCancelled') };
}

export function emptyAnswerFailure(t: TranslateFn): ChatFailure {
  return { kind: 'empty-answer', message: t('Chat_EmptyAnswer') };
}

/** xAI is gone: a settings file that still selects it asks the user to pick another provider. */
export function providerRemovedFailure(t: TranslateFn): ChatFailure {
  return { kind: 'provider-removed', message: t('Ui_SummaryProviderXaiRemoved') };
}

/**
 * B14: the detail comes from the shared mapper, never from the raw error. A CLI failure, a local
 * budget failure (`PromptTooLong`) and a plain error all end up as `Chat_SendFailed` plus a
 * mapped sentence in the right language.
 */
export function sendFailedFailure(error: unknown, t: TranslateFn): ChatFailure {
  return { kind: 'send-failed', message: t('Chat_SendFailed', formatFailure(error, t)) };
}
