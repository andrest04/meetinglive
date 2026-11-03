import type { TranslateFn } from '../i18n/translator';
import { CliToolError, type CliFailureKind } from './cli-failure';

/** Stable codes for failures that are not CLI failures (B28). Text lives in the catalogs. */
export const SUMMARY_ERROR_CODES = [
  'LocalModelMissing',
  'LocalEmpty',
  'NotesTooLong',
  'TranscriptTooLong',
  'CannotCondense',
  'PromptTooLong',
  'Cancelled',
] as const;
export type SummaryErrorCode = (typeof SUMMARY_ERROR_CODES)[number];

/** Core never builds English text: it carries a code and the values the sentence needs. */
export class SummaryError extends Error {
  readonly code: SummaryErrorCode;
  readonly args: readonly (string | number)[];

  constructor(code: SummaryErrorCode, args: readonly (string | number)[] = [], cause?: unknown) {
    super(`summary error: ${code}`, cause === undefined ? undefined : { cause });
    this.name = 'SummaryError';
    this.code = code;
    this.args = args;
  }
}

/** Kind to the UI layer key (`CliFailureUserMessage`, spec 2.5). `{0}` is the display name. */
export const CLI_FAILURE_UI_KEYS: Readonly<Record<CliFailureKind, string>> = {
  NotInstalled: 'Error_CliNotInstalled',
  NotSignedIn: 'Error_CliNotSignedIn',
  SubscriptionInactive: 'Error_CliSubscriptionInactive',
  TimedOut: 'Error_CliTimedOut',
  EmptyOutput: 'Error_CliEmptyOutput',
  Unknown: 'Error_CliUnknown',
};

/** Kind to the Core catalog key (`CliFailureMapper.BuildMessage`). */
export const CLI_FAILURE_CORE_KEYS: Readonly<Record<CliFailureKind, string>> = {
  NotInstalled: 'CliFailureNotInstalled',
  NotSignedIn: 'CliFailureNotSignedIn',
  SubscriptionInactive: 'CliFailureSubscriptionInactive',
  TimedOut: 'CliFailureTimedOut',
  EmptyOutput: 'CliFailureEmptyOutput',
  Unknown: 'CliFailureUnknown',
};

export const SUMMARY_ERROR_KEYS: Readonly<Record<SummaryErrorCode, string>> = {
  LocalModelMissing: 'Ui_SummaryLocalModelMissing',
  LocalEmpty: 'Ui_SummaryLocalEmpty',
  NotesTooLong: 'Ui_SummaryNotesTooLong',
  TranscriptTooLong: 'Ui_SummaryTranscriptTooLong',
  CannotCondense: 'Ui_SummaryCannotCondense',
  PromptTooLong: 'Ui_SummaryPromptTooLong',
  Cancelled: 'Status_ProcessingCancelled',
};

/** Every catalog key this module can ask for, so a test can prove both locales carry them. */
export const SUMMARY_FAILURE_CATALOG_KEYS: readonly string[] = [
  ...Object.values(CLI_FAILURE_UI_KEYS),
  ...Object.values(CLI_FAILURE_CORE_KEYS),
  ...Object.values(SUMMARY_ERROR_KEYS),
];

/** The sentence a person reads for a failed summary or title, in the locale of `translate`. */
export function formatFailure(error: unknown, translate: TranslateFn): string {
  if (error instanceof CliToolError) {
    const text = translate(CLI_FAILURE_UI_KEYS[error.kind], error.displayName);
    return error.kind === 'Unknown' && error.detail ? `${text} ${error.detail}` : text;
  }
  if (error instanceof SummaryError) {
    return translate(SUMMARY_ERROR_KEYS[error.code], ...error.args);
  }
  return error instanceof Error ? error.message : String(error);
}
