import { compactMeetingId } from './context-packer';

/** Citation prefix (spec 3.4, 4.2). The host is fake on purpose: the renderer intercepts these links. */
export const MEETING_LINK_PREFIX = 'https://meetinglive.local/meeting/';

/** `prefix` plus the id as 32 lowercase hex digits (.NET `Guid.ToString("N")`). */
export const meetingLink = (id: string): string => MEETING_LINK_PREFIX + compactMeetingId(id);

const HEX32 = /^[0-9a-f]{32}$/i;
const HYPHENATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `Guid.TryParse` shapes: N, D, braced D and parenthesized D. Returns 32 lowercase hex or null. */
function parseGuidToHex(text: string): string | null {
  const t = text.trim();
  const wrapped = /^\{.*\}$/.test(t) || /^\(.*\)$/.test(t);
  const core = wrapped ? t.slice(1, -1) : t;
  if (HYPHENATED.test(core)) return core.replace(/-/g, '').toLowerCase();
  if (!wrapped && HEX32.test(core)) return core.toLowerCase();
  return null;
}

/**
 * The meeting id (32 lowercase hex) when `link` is a meeting citation, else null. The prefix match
 * ignores case; trailing slashes are dropped; a query, fragment or extra segment makes the id
 * unparseable, so the link is rejected.
 */
export function tryParseMeetingLink(link: string | null | undefined): string | null {
  if (link === null || link === undefined) return null;
  if (link.slice(0, MEETING_LINK_PREFIX.length).toLowerCase() !== MEETING_LINK_PREFIX) return null;
  return parseGuidToHex(link.slice(MEETING_LINK_PREFIX.length).replace(/\/+$/, ''));
}
