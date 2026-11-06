import type { CancelSignal } from '../cancel';
import { CancelledError, isCancellation, throwIfCancelled } from './provider';

/** Spec 2.5. */
export const CLI_FAILURE_KINDS = [
  'NotInstalled',
  'NotSignedIn',
  'SubscriptionInactive',
  'TimedOut',
  'EmptyOutput',
  'Unknown',
] as const;
export type CliFailureKind = (typeof CLI_FAILURE_KINDS)[number];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (word: string): RegExp => new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
const hasPhrase = (text: string, needle: string): boolean => text.toLowerCase().includes(needle);

const NOT_INSTALLED_PHRASES = ['not found', 'cannot find'];
const SUBSCRIPTION_PHRASES = ['payment required', 'plan expired'];
const SUBSCRIPTION_WORDS = ['402', 'subscription', 'billing', 'payment', 'quota', 'credit'].map(
  wholeWord,
);
const NOT_SIGNED_IN_PHRASES = [
  'not logged in',
  'sign in',
  'sign-in',
  'unauthorized',
  'session expired',
  'token expired',
  'authentication',
];
const NOT_SIGNED_IN_WORDS = ['login', 'oauth', 'auth', '401'].map(wholeWord);
const PLEASE_RUN_LOGIN = /please run.{0,80}login/i;
const TIMED_OUT_PHRASES = ['timed out', 'time out', 'time-out'];
const TIMEOUT_WORD = wholeWord('timeout');
const ENOENT = wholeWord('ENOENT');

/**
 * B12: "model not found" and "404 Not Found" are API answers about a model or a URL, not a missing
 * program. They are removed before the not-installed check.
 */
const API_NOT_FOUND = [
  /\bmodel\b[^\n.]{0,60}?\bnot found\b/gi,
  /\b404\b[^\n]{0,12}\bnot found\b/gi,
];

function stripApiNotFound(text: string): string {
  return API_NOT_FOUND.reduce((acc, pattern) => acc.replace(pattern, ' '), text);
}

/** The spec 2.5 order over one block of text. Null when nothing matches. */
function classifyText(raw: string): CliFailureKind | null {
  const text = stripApiNotFound(raw);
  if (NOT_INSTALLED_PHRASES.some((p) => hasPhrase(text, p)) || ENOENT.test(text)) {
    return 'NotInstalled';
  }
  if (
    SUBSCRIPTION_PHRASES.some((p) => hasPhrase(text, p)) ||
    SUBSCRIPTION_WORDS.some((r) => r.test(text))
  ) {
    return 'SubscriptionInactive';
  }
  if (
    NOT_SIGNED_IN_PHRASES.some((p) => hasPhrase(text, p)) ||
    NOT_SIGNED_IN_WORDS.some((r) => r.test(text)) ||
    PLEASE_RUN_LOGIN.test(text)
  ) {
    return 'NotSignedIn';
  }
  if (TIMED_OUT_PHRASES.some((p) => hasPhrase(text, p)) || TIMEOUT_WORD.test(text)) {
    return 'TimedOut';
  }
  return null;
}

/**
 * B12: stdout is the model's answer, so a summary that talks about billing or quota must not be
 * read as a failure. Only phrases a CLI prints to report its own failure count there.
 */
const STDOUT_SENTINELS: readonly (readonly [CliFailureKind, RegExp])[] = [
  ['NotSignedIn', /\bnot logged in\b/i],
  ['NotSignedIn', /please run.{0,80}login/i],
  ['NotSignedIn', /\b(?:session|token) expired\b/i],
  ['SubscriptionInactive', /\bpayment required\b/i],
  ['SubscriptionInactive', /\bplan expired\b/i],
];

function classifyStdoutSentinel(stdout: string): CliFailureKind | null {
  for (const [kind, pattern] of STDOUT_SENTINELS) if (pattern.test(stdout)) return kind;
  return null;
}

/** Spec 2.5 `Classify`, first match wins, with B12 applied: stderr first, stdout sentinels only. */
export function classifyFailure(
  exitCode: number,
  stdout: string | null | undefined,
  stderr: string | null | undefined,
  isOnPath = true,
): CliFailureKind {
  if (!isOnPath) return 'NotInstalled';
  const out = stdout ?? '';
  const err = stderr ?? '';
  if (exitCode === 0 && out.trim() === '') return 'EmptyOutput';
  return classifyText(err) ?? classifyStdoutSentinel(out) ?? 'Unknown';
}

const REDACTION =
  /Bearer\s+\S+|(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{20,}/gi;

/** Spec 2.5: redact secrets, collapse whitespace, cap at 120 characters with an ellipsis. */
export function sanitizeSnippet(text: string | null | undefined, max = 120): string | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  const clean = text.trim().replace(REDACTION, '[redacted]').replace(/\s+/g, ' ');
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

/**
 * A CLI failure as data (B28): the kind and display name pick the localized text, `detail` is the
 * sanitized snippet and exists only for Unknown. The exit code is never kept. `message` is for
 * logs, not for the user.
 */
export class CliToolError extends Error {
  readonly kind: CliFailureKind;
  readonly displayName: string;
  readonly detail: string | null;

  constructor(
    displayName: string,
    kind: CliFailureKind,
    detail: string | null = null,
    cause?: unknown,
  ) {
    const kept = kind === 'Unknown' ? detail : null;
    super(
      `${displayName}: ${kind}${kept ? ` ${kept}` : ''}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'CliToolError';
    this.kind = kind;
    this.displayName = displayName;
    this.detail = kept;
  }

  /** From a finished process that failed (`Create(displayName, exitCode, stdout, stderr)`). */
  static fromProcess(
    displayName: string,
    exitCode: number,
    stdout: string | null | undefined,
    stderr: string | null | undefined,
  ): CliToolError {
    const kind = classifyFailure(exitCode, stdout, stderr);
    const first = [stderr, stdout].find((s) => s !== null && s !== undefined && s.trim() !== '');
    return new CliToolError(displayName, kind, kind === 'Unknown' ? sanitizeSnippet(first) : null);
  }
}

/** Raised by a runner when the process outlived its timeout. */
export class CliTimeoutError extends Error {
  constructor(message = 'timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Spawn errors that mean the program cannot be run at all. */
const CANNOT_RUN_CODES = new Set(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']);

/** Spec 2.5 `Classify(Exception)`. */
export function classifyException(error: unknown): CliFailureKind {
  if (error instanceof CliToolError) return error.kind;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'TimedOut';
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && CANNOT_RUN_CODES.has(code)) return 'NotInstalled';
  }
  const message = error instanceof Error ? error.message : String(error);
  return classifyFailure(1, null, message);
}

/** Cancellation is never wrapped; a CliToolError passes through; anything else is classified. */
export function wrapCliError(displayName: string, error: unknown): unknown {
  if (isCancellation(error) || error instanceof CliToolError) return error;
  const kind = classifyException(error);
  const message = error instanceof Error ? error.message : String(error);
  const detail = kind === 'Unknown' ? sanitizeSnippet(message) : null;
  return new CliToolError(displayName, kind, detail, error);
}

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What the failure orchestration needs from a process runner (the Node one is S05). */
export interface CliProcessRunner {
  isOnPath(executable: string): boolean | Promise<boolean>;
  run(
    executable: string,
    args: readonly string[],
    stdin: string | null,
    timeoutMs: number,
    cancel: CancelSignal,
    options?: { readonly cwd?: string },
  ): Promise<CliRunResult>;
}

/**
 * Spec 2.5 `RunRequiredStdoutAsync`: not on PATH is NotInstalled before any spawn, a non-zero exit
 * is classified, trimmed empty output is EmptyOutput. Returns the trimmed stdout.
 */
export async function runRequiredStdout(
  runner: CliProcessRunner,
  executable: string,
  args: readonly string[],
  stdin: string | null,
  timeoutMs: number,
  displayName: string,
  cancel: CancelSignal,
  options?: { readonly cwd?: string },
): Promise<string> {
  throwIfCancelled(cancel);
  if (!(await runner.isOnPath(executable))) throw new CliToolError(displayName, 'NotInstalled');
  let result: CliRunResult;
  try {
    result =
      options === undefined
        ? await runner.run(executable, args, stdin, timeoutMs, cancel)
        : await runner.run(executable, args, stdin, timeoutMs, cancel, options);
  } catch (error) {
    throw wrapCliError(displayName, error);
  }
  if (cancel.cancelled) throw new CancelledError();
  if (result.exitCode !== 0) {
    throw CliToolError.fromProcess(displayName, result.exitCode, result.stdout, result.stderr);
  }
  const raw = result.stdout.trim();
  if (raw === '') throw new CliToolError(displayName, 'EmptyOutput');
  return raw;
}
