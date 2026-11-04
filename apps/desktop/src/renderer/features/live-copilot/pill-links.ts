/**
 * The only links the pill follows (spec 2.8 item 3): an absolute http or https address. Meeting
 * citations, mailto:, file:, javascript: and anything that is not an address are ignored.
 */
export function classifyPillLink(href: string): string | null {
  try {
    const url = new URL(href.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
