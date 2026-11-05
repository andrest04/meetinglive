import { foldText, foldedWords } from '@vozella/core';
import type { MeetingListItemDto, SearchHitDto } from '@vozella/contracts';

export type MeetingTab = 'Transcript' | 'Summary';

export type SearchHits = ReadonlyMap<string, SearchHitDto>;

/** The view's own date order, narrowed to title matches plus what was found inside meetings. */
export function mergeMatches(
  inView: readonly MeetingListItemDto[],
  byTitle: readonly MeetingListItemDto[],
  hits: SearchHits,
): readonly MeetingListItemDto[] {
  if (hits.size === 0) return byTitle;
  const titled = new Set(byTitle.map((meeting) => meeting.id));
  return inView.filter((meeting) => titled.has(meeting.id) || hits.has(meeting.id));
}

/** The tab that shows what was found. Notes live on the Summary tab. A title says nothing. */
export function tabOfHit(hit: SearchHitDto | undefined): MeetingTab | null {
  if (!hit) return null;
  if (hit.field === 'transcript') return 'Transcript';
  return hit.field === 'title' ? null : 'Summary';
}

/** Characters kept before a match when the text is cut to bring the match into a narrow row. */
const LEAD_CHARS = 12;

/**
 * A row shows only the start of its snippet, and the words found can sit past where it ends. This
 * cuts the text at a word just before the first match. Nothing changes when none is found.
 */
export function snippetAroundMatch(snippet: string, query: string): string {
  let at = 0;
  for (const part of highlightParts(snippet, query)) {
    if (part.mark) {
      if (at <= LEAD_CHARS) return snippet;
      const space = snippet.indexOf(' ', at - LEAD_CHARS);
      return `…${snippet.slice(space === -1 || space >= at ? at : space + 1)}`;
    }
    at += part.text.length;
  }
  return snippet;
}

export interface HighlightPart {
  readonly text: string;
  readonly mark: boolean;
}

function matchedRanges(folded: string, words: readonly string[]): readonly [number, number][] {
  const ranges: [number, number][] = [];
  for (const word of words) {
    for (
      let at = folded.indexOf(word);
      at !== -1;
      at = folded.indexOf(word, at + Math.max(word.length, 1))
    ) {
      ranges.push([at, at + word.length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = joined.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else joined.push([start, end]);
  }
  return joined;
}

/** Splits text around the query's words. Folding keeps the length, so offsets fit the original. */
export function highlightParts(text: string, query: string): readonly HighlightPart[] {
  const folded = foldText(text);
  const words = foldedWords(query).filter((word) => word !== '');
  if (words.length === 0 || folded.length !== text.length) return [{ text, mark: false }];
  const parts: HighlightPart[] = [];
  let from = 0;
  for (const [start, end] of matchedRanges(folded, words)) {
    if (start > from) parts.push({ text: text.slice(from, start), mark: false });
    parts.push({ text: text.slice(start, end), mark: true });
    from = end;
  }
  if (from < text.length) parts.push({ text: text.slice(from), mark: false });
  return parts;
}
