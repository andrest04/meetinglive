import { cutPrefix } from '../chat/text-cut';
import { extractCommittedBody, isTranscriptHeader } from '../transcription/committed-line';
import type { MeetingListItem, MeetingRecord } from './meeting';

export const SNIPPET_MAX_LENGTH = 140;

const HEADING = /^#{1,6}(?:\s|$)/;

// B15 rule: after the fences (```), double markers and backticks are removed as in the spec,
// but a single `*` or `_` (and a doubled one) is removed only when it wraps text: the opener is
// not glued to a word character before it and not followed by a space, the closer is not
// preceded by a space and not glued to a word character after it. So `snake_case`, file names,
// URLs and `a*b` keep their markers while `*it*` and `_it_` lose them.
const WRAP_STAR2 = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const WRAP_UNDER2 = /(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g;
const WRAP_STAR = /(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g;
const WRAP_UNDER = /(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])/g;

function stripMarkers(line: string, heading: boolean): string {
  let text = line.trim();
  if (heading) text = text.replace(/^#{1,6}\s*/, '');
  return text
    .replace(/```/g, '')
    .replace(WRAP_STAR2, '$1')
    .replace(WRAP_UNDER2, '$1')
    .replace(/`/g, '')
    .replace(WRAP_STAR, '$1')
    .replace(WRAP_UNDER, '$1')
    .trim();
}

/** One line of Markdown without its heading mark and inline markers. */
export function plainMarkdownLine(line: string): string {
  return stripMarkers(line, HEADING.test(line.trim()));
}

/** One-line preview of Markdown: body text first, headings only when there is no body. */
export function snippetFromMarkdown(markdown: string): string {
  if (markdown.trim() === '') return '';
  let body = '';
  let headings = '';
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING.test(raw.trim());
    const text = stripMarkers(raw, heading);
    if (text === '') continue;
    if (heading) headings = headings === '' ? text : `${headings} ${text}`;
    else body = body === '' ? text : `${body} ${text}`;
  }
  const chosen = (body !== '' ? body : headings).replace(/\s+/g, ' ').trim();
  return chosen.length > SNIPPET_MAX_LENGTH ? `${cutPrefix(chosen, SNIPPET_MAX_LENGTH)}…` : chosen;
}

// The line grammar lives in the transcription module; these names stay for the callers here.
export { isTranscriptHeader };
/** The spoken text of one transcript line, without the star, the stamp and the speaker tag. */
export const committedLineBody = extractCommittedBody;

/** What was said: no header lines, stamps or speaker tags. */
export function spokenTranscript(transcript: string): string {
  return transcript
    .split(/\r\n|\n|\r/)
    .filter((line) => line !== '' && !isTranscriptHeader(line))
    .map(committedLineBody)
    .filter((text) => text !== '')
    .join('\n');
}

/** Spec 3.15: the summary when there is one, otherwise the spoken transcript. */
export function meetingSnippet(summary: string | null, transcript: string | null): string {
  if (summary !== null && summary.trim() !== '') return snippetFromMarkdown(summary);
  return snippetFromMarkdown(spokenTranscript(transcript ?? ''));
}

const hasText = (value: string | null): boolean => value !== null && value.trim() !== '';

/** The list's view of a stored meeting. Whether it is busy is not stored, so it starts false. */
export function meetingListItem(record: MeetingRecord): MeetingListItem {
  return {
    id: record.id,
    title: record.title,
    recordedAt: record.recordedAt,
    endedAt: record.endedAt,
    folderId: record.folderId,
    snippet: meetingSnippet(record.summary, record.transcript),
    hasSummary: hasText(record.summary),
    hasTranscript: hasText(record.transcript),
    busy: false,
  };
}
