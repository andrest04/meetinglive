import { takeHead } from './utf16';

export const MAX_SESSION_CONTEXT_CHARS = 1500;

/** Title and brief as one context block for the prompt (item 124). Null when both are blank. */
export function buildSessionContext(
  title: string | null | undefined,
  brief: string | null | undefined,
): string | null {
  const t = title?.trim() ?? '';
  const b = brief?.trim() ?? '';
  if (t === '' && b === '') return null;
  const text = t === '' ? b : b === '' ? `Meeting: ${t}` : `Meeting: ${t}\n${b}`;
  // Bug 16: the cut never leaves half of a surrogate pair.
  return text.length > MAX_SESSION_CONTEXT_CHARS
    ? takeHead(text, MAX_SESSION_CONTEXT_CHARS).trimEnd()
    : text;
}
