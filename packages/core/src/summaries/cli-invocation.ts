import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  CODEX_EFFORTS,
  CODEX_MODELS,
} from '../settings/inference-options';

/**
 * Spec 3.7, B30. Arguments are built as argv arrays and spawned without a shell, so a value can
 * never become a second argument or a shell fragment. Model and effort come from a settings file
 * the user can edit, so they are checked before they reach the command line.
 */

/** A stored value outside the allow-list is still accepted when it looks like a plain identifier. */
const CONSERVATIVE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Raised before any process starts when a model or effort value is not safe to pass. */
export class InvalidCliOptionError extends Error {
  readonly option: 'model' | 'effort';

  constructor(option: 'model' | 'effort', value: string) {
    const shown = value.length > 40 ? `${value.slice(0, 40)}...` : value;
    super(
      `The ${option} "${shown}" is not allowed. Use letters, digits, dots, colons, underscores and hyphens only, starting with a letter or digit.`,
    );
    this.name = 'InvalidCliOptionError';
    this.option = option;
  }
}

/**
 * The trimmed value, or null when blank (the option is then left out). Values in the allow-list
 * pass as they are; any other value must match the conservative pattern.
 */
export function validateCliOption(
  option: 'model' | 'effort',
  value: string | null | undefined,
  allowList: readonly string[],
): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  if (allowList.includes(trimmed) || CONSERVATIVE_VALUE.test(trimmed)) return trimmed;
  throw new InvalidCliOptionError(option, trimmed);
}

export interface CliInvocationOptions {
  readonly model?: string | null;
  readonly effort?: string | null;
  readonly webSearch?: boolean;
}

/**
 * Skips the user's own Claude Code hooks, MCP servers and slash commands. Vozella needs none of
 * them, and they dominate start-up: measured 19.2 s to the first token with them, 4.4 s without.
 * Sign-in is unaffected (unlike `--bare`, which never reads OAuth).
 */
export const CLAUDE_LEAN_FLAGS = [
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
] as const;

/** `claude -p <lean flags> [--model m] [--effort e] [--tools WebSearch --allowedTools WebSearch]`. */
export function claudePrintArgs(options: CliInvocationOptions = {}): string[] {
  const model = validateCliOption('model', options.model, CLAUDE_MODELS);
  const effort = validateCliOption('effort', options.effort, CLAUDE_EFFORTS);
  const args: string[] = ['-p', ...CLAUDE_LEAN_FLAGS];
  if (model !== null) args.push('--model', model);
  if (effort !== null) args.push('--effort', effort);
  if (options.webSearch === true) args.push('--tools', 'WebSearch', '--allowedTools', 'WebSearch');
  return args;
}

/** `codex [--search] exec - [-m m] [-c model_reasoning_effort="e"]`. `--search` precedes `exec`. */
export function codexExecArgs(options: CliInvocationOptions = {}): string[] {
  const model = validateCliOption('model', options.model, CODEX_MODELS);
  const effort = validateCliOption('effort', options.effort, CODEX_EFFORTS);
  const args: string[] = [];
  if (options.webSearch === true) args.push('--search');
  args.push('exec', '-');
  if (model !== null) args.push('-m', model);
  if (effort !== null) args.push('-c', `model_reasoning_effort="${effort}"`);
  return args;
}

/** Appended to `claudePrintArgs` for chat streaming: one JSON event per line, with text deltas. */
export const CLAUDE_STREAM_FLAGS = [
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
] as const;

/** Appended to `codexExecArgs` for chat streaming: `exec --json` prints JSONL events. */
export const CODEX_STREAM_FLAGS = ['--json'] as const;

/** `claudePrintArgs` plus the stream-json flags. */
export function claudeStreamArgs(options: CliInvocationOptions = {}): string[] {
  return [...claudePrintArgs(options), ...CLAUDE_STREAM_FLAGS];
}

/** `codexExecArgs` plus `--json` (an `exec` option, so it goes after `exec`). */
export function codexStreamArgs(options: CliInvocationOptions = {}): string[] {
  return [...codexExecArgs(options), ...CODEX_STREAM_FLAGS];
}

/** The WinUI quoting: double quotes only when the value has a space, no escaping. */
const quoteIfSpaced = (value: string): string => (value.includes(' ') ? `"${value}"` : value);
const isBlank = (value: string | null | undefined): value is null | undefined =>
  value === null || value === undefined || value.trim() === '';

/**
 * The legacy argument string of `CliInvocation.ClaudePrint`, kept so the old tests port 1:1 and
 * logs can show a command. It does no validation and is never used to start a process.
 */
export function claudePrintLine(
  model: string | null | undefined,
  effort: string | null | undefined,
  webSearch = false,
): string {
  let line = '-p';
  if (!isBlank(model)) line += ` --model ${quoteIfSpaced(model.trim())}`;
  if (!isBlank(effort)) line += ` --effort ${effort.trim()}`;
  if (webSearch) line += ' --tools WebSearch --allowedTools WebSearch';
  return line;
}

/** The legacy argument string of `CliInvocation.CodexExec`. Display only, see `claudePrintLine`. */
export function codexExecLine(
  model: string | null | undefined,
  effort: string | null | undefined,
  webSearch = false,
): string {
  let line = webSearch ? '--search exec -' : 'exec -';
  if (!isBlank(model)) line += ` -m ${quoteIfSpaced(model.trim())}`;
  if (!isBlank(effort)) line += ` -c model_reasoning_effort="${effort.trim()}"`;
  return line;
}
