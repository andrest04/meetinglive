import type { SummaryProviderKind } from '../library/settings';

/** Only the two CLI providers can search the web. Local ignores the flag (xAI is gone). */
export function supportsWebSearch(kind: SummaryProviderKind): boolean {
  return kind === 'ClaudeCode' || kind === 'Codex';
}

/**
 * The typed question searches the web only when the provider can and the user switched it on. The
 * automatic needs-web verdict was dropped (owner decision 2026-11-03, may return later).
 */
export function shouldUseWeb(providerSupportsWeb: boolean, forced: boolean): boolean {
  return providerSupportsWeb && forced;
}
