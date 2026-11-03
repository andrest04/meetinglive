import type { CliProcessRunner } from './cli-failure';
import { claudePrintArgs } from './cli-invocation';
import { CliToolProvider } from './cli-provider';

export interface CliProviderOptions {
  readonly model?: string | null;
  readonly effort?: string | null;
  /** Only the live-answer path asks for this (item 71). Summaries never do. */
  readonly webSearch?: boolean;
  /** Defaults to five minutes. */
  readonly timeoutMs?: number;
}

export class ClaudeCodeSummaryProvider extends CliToolProvider {
  readonly id = 'claude-code' as const;
  protected readonly executable = 'claude';
  protected readonly displayName = 'Claude Code';

  constructor(
    runner: CliProcessRunner,
    private readonly options: CliProviderOptions = {},
  ) {
    super(runner, options.timeoutMs);
  }

  protected buildArgs(): readonly string[] {
    return claudePrintArgs(this.options);
  }
}

/** The plain provider for summaries, titles and prompts. */
export function createClaudeCodeProvider(
  runner: CliProcessRunner,
  options: Omit<CliProviderOptions, 'webSearch'> = {},
): ClaudeCodeSummaryProvider {
  return new ClaudeCodeSummaryProvider(runner, { ...options, webSearch: false });
}

/** The web-search variant, for the live-answer path only. */
export function createClaudeCodeWebSearchProvider(
  runner: CliProcessRunner,
  options: Omit<CliProviderOptions, 'webSearch'> = {},
): ClaudeCodeSummaryProvider {
  return new ClaudeCodeSummaryProvider(runner, { ...options, webSearch: true });
}
