/** One non-empty transcript line, tagged so a model can point at it (spec 3.13). */
export interface TranscriptLine {
  readonly id: string;
  readonly index: number;
  readonly text: string;
}

export const MAX_CHOICE_OPTIONS = 255;

/** `L000`; grows past 999 instead of wrapping. */
export const lineId = (index: number): string => `L${String(index).padStart(3, '0')}`;

/** Non-empty trimmed lines, numbered in order. Blank input gives none. */
export function parseTranscriptLines(transcript: string | null): TranscriptLine[] {
  if (transcript === null || transcript.trim() === '') return [];
  const lines: TranscriptLine[] = [];
  for (const part of transcript.split(/\r\n|\n/)) {
    const text = part.trim();
    if (text === '') continue;
    const index = lines.length;
    lines.push({ id: lineId(index), index, text });
  }
  return lines;
}

const formatTaggedLine = (line: TranscriptLine): string => `${line.id}| ${line.text}`;

export function buildTaggedDocument(lines: readonly TranscriptLine[]): string {
  return lines.map(formatTaggedLine).join('\n');
}

/** Keeps whole leading lines while the tagged document fits; always keeps the first line. */
export function truncateToCompleteLines(
  lines: readonly TranscriptLine[],
  maxChars: number,
): TranscriptLine[] {
  const first = lines[0];
  if (first === undefined || maxChars <= 0) return [];
  if (buildTaggedDocument(lines).length <= maxChars) return [...lines];
  const kept: TranscriptLine[] = [];
  let length = 0;
  for (const line of lines) {
    const add = formatTaggedLine(line).length + (kept.length > 0 ? 1 : 0);
    if (length + add > maxChars) break;
    kept.push(line);
    length += add;
  }
  if (kept.length === 0) kept.push(first);
  return kept;
}
