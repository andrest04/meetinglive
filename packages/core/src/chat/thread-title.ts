import { cutPrefix } from './text-cut';

export const MAX_THREAD_TITLE_CHARS = 60;

/** Spec 3.6: trim, every line ending sequence to one space, cut to 60 (code-point safe), trimEnd. */
export function threadTitleFromFirstMessage(userMessage: string): string {
  const flat = userMessage.trim().replace(/\r\n|[\r\n\u0085\u2028\u2029]/g, ' ');
  return flat.length > MAX_THREAD_TITLE_CHARS
    ? cutPrefix(flat, MAX_THREAD_TITLE_CHARS).trimEnd()
    : flat;
}
