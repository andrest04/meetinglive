import { extractCommittedBody, isTranscriptHeader } from '../transcription/committed-line';

export const SNIPPET_MAX_LENGTH = 140;

const HEADING = /^#{1,6}(?:\s|$)/;

function stripMarkers(line: string, heading: boolean): string {
  let text = line.trim();
  if (heading) text = text.replace(/^#{1,6}\s*/, '');
  return text
    .replace(/```/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .trim();
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
  return chosen.length > SNIPPET_MAX_LENGTH ? `${chosen.slice(0, SNIPPET_MAX_LENGTH)}…` : chosen;
}

// The line grammar lives in the transcription module; these names stay for the callers here.
export { isTranscriptHeader };
/** The spoken text of one transcript line, without the star, the stamp and the speaker tag. */
export const committedLineBody = extractCommittedBody;

function transcriptBody(transcript: string): string {
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
  return snippetFromMarkdown(transcriptBody(transcript ?? ''));
}
