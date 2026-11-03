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

// `CommittedTranscriptLine` (transcription module): `[mm:ss.ff-mm:ss.ff] [ Speaker-N ] text`.
const SIDE = /^\d{2,}:[0-5]\d\.\d{2}$/;

function validStamp(stamp: string): boolean {
  const dash = stamp.indexOf('-');
  if (dash <= 0 || dash === stamp.length - 1) return false;
  return SIDE.test(stamp.slice(0, dash)) && SIDE.test(stamp.slice(dash + 1));
}

export function isTranscriptHeader(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('Recorded ') || trimmed.startsWith('Ended ');
}

/** The spoken text of one transcript line, without the stamp and speaker tag. */
export function committedLineBody(line: string): string {
  if (line === '') return '';
  if (line.startsWith('[')) {
    const close = line.indexOf(']');
    if (close > 1 && validStamp(line.slice(1, close))) {
      return line
        .slice(close + 1)
        .replace(/^\s*\[ Speaker-\d+ \]/, '')
        .trim();
    }
  }
  return line.trim();
}

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
