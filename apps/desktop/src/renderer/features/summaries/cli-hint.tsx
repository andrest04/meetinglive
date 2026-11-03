import type { SummaryCliKindDto } from '@vozella/contracts';
import type { ReactNode } from 'react';

/** What the renderer knows about each CLI before it asks main: the executable and the hint key. */
export const CLI_FACTS = {
  ClaudeCode: { executable: 'claude', hintKey: 'Cli_ClaudeHint', nameKey: 'Cli_ClaudeName' },
  Codex: { executable: 'codex', hintKey: 'Cli_CodexHint', nameKey: 'Cli_CodexName' },
} as const satisfies Record<
  SummaryCliKindDto,
  {
    readonly executable: string;
    readonly hintKey: 'Cli_ClaudeHint' | 'Cli_CodexHint';
    readonly nameKey: 'Cli_ClaudeName' | 'Cli_CodexName';
  }
>;

const URL_PATTERN = /https:\/\/[^\s"()]*[^\s"().,]/g;

/**
 * Shows a message with its https addresses as links. A click opens a window that main denies and
 * hands to the system browser only when the address is https (see security/external-url).
 */
export function LinkedText({ text }: { readonly text: string }): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a
        key={match.index}
        href={match[0]}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:opacity-80"
      >
        {match[0]}
      </a>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
