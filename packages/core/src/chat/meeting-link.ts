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
  if (!hasMeetingPrefix(link)) return null;
  return parseGuidToHex(link.slice(MEETING_LINK_PREFIX.length).replace(/\/+$/, ''));
}

/** Whether `link` starts with the citation prefix (case ignored), valid or not after it. */
export function hasMeetingPrefix(link: string | null | undefined): link is string {
  return link?.slice(0, MEETING_LINK_PREFIX.length).toLowerCase() === MEETING_LINK_PREFIX;
}

/** Upper bound of a cited moment: one day of audio. */
export const MAX_CITATION_SECONDS = 86_400;

/** A meeting citation, optionally pointing at a moment of its transcript (T3). */
export interface MeetingCitation {
  /** 32 lowercase hex. */
  readonly meetingId: string;
  /** Whole seconds from the start of the recording, or null for the meeting itself. */
  readonly seconds: number | null;
}

const TIME_QUERY = /^t=(\d{1,5})$/;

/**
 * A meeting citation with an optional `?t=<whole seconds>` (0 to one day). Any other query, a
 * fragment, an extra segment or a bad id rejects the whole link.
 */
export function tryParseMeetingCitation(link: string | null | undefined): MeetingCitation | null {
  if (!hasMeetingPrefix(link)) return null;
  const rest = link.slice(MEETING_LINK_PREFIX.length);
  const queryAt = rest.indexOf('?');
  const path = queryAt < 0 ? rest : rest.slice(0, queryAt);
  const meetingId = parseGuidToHex(path.replace(/\/+$/, ''));
  if (meetingId === null) return null;
  if (queryAt < 0) return { meetingId, seconds: null };
  const time = TIME_QUERY.exec(rest.slice(queryAt + 1));
  if (!time) return null;
  const seconds = Number(time[1]);
  return seconds <= MAX_CITATION_SECONDS ? { meetingId, seconds } : null;
}

/** A citation of one moment: the meeting link plus `?t=` in whole seconds. */
export const meetingTimeLink = (id: string, seconds: number): string =>
  `${meetingLink(id)}?t=${String(Math.max(0, Math.floor(seconds)))}`;
