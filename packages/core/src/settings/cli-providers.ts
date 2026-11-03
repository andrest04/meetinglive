import type { SummaryProviderKind } from '../library/settings';

export type CliProviderKind = Extract<SummaryProviderKind, 'ClaudeCode' | 'Codex'>;

export const isCliProvider = (kind: SummaryProviderKind): kind is CliProviderKind =>
  kind === 'ClaudeCode' || kind === 'Codex';

/** The program name looked up on PATH. Other kinds are not CLI backed. */
export function cliExecutableName(kind: SummaryProviderKind): 'claude' | 'codex' {
  if (!isCliProvider(kind))
    throw new RangeError('Only ClaudeCode and Codex are CLI-backed providers.');
  return kind === 'ClaudeCode' ? 'claude' : 'codex';
}

/** Catalog keys for the line under the provider radios. */
export const CLI_STATUS_KEYS = { found: 'Status_CliOnPath', missing: 'Status_CliMissing' } as const;
