import { cutPrefix, cutTail } from '../chat/text-cut';
import { meetingInstant } from './library-view';
import type { MeetingListItem, MeetingRecord } from './meeting';
import { SNIPPET_MAX_LENGTH, plainMarkdownLine, spokenTranscript } from './snippet';
import { foldText, foldedWords, hasAllWords } from './text-fold';

/** Where a search hit lies, in the order a tie is settled. The UI opens the matching tab. */
export const SEARCH_FIELDS = ['title', 'summary', 'notes', 'transcript'] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

export type MeetingSearchText = Readonly<Record<SearchField, string>>;

/** One meeting as a search sees it: folded text in memory, the original only on request. */
export interface MeetingBody {
  readonly item: MeetingListItem;
  readonly folded: MeetingSearchText;
  /** Reads the file again. Null when it can no longer be read as a meeting. */
  readonly original: () => Promise<MeetingSearchText | null>;
}

export interface SearchHit {
  readonly meetingId: string;
  readonly field: SearchField;
  /** Null for a title hit, and past the newest hits: the list then shows its own snippet. */
  readonly snippet: string | null;
}

/** A shorter query would match nearly everything and cost a read of every file. */
export const MIN_SEARCH_CHARS = 2;
/** Re-reading a file for its snippet is the slow part, so only the top of the list gets one. */
export const MAX_ORIGINAL_SNIPPETS = 200;

const READ_CONCURRENCY = 16;
const SNIPPET_LEAD = 40;

const joined = (parts: readonly (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== '').join('\n');

/** The searchable text of a meeting. Stamps and speaker tags are not words anyone said. */
export function meetingSearchText(record: MeetingRecord): MeetingSearchText {
  return {
    title: record.title,
    summary: joined([
      record.summary,
      ...record.actionItems.map((item) => item.text),
      record.followUp,
      record.projectPlan,
    ]),
    notes: joined([record.notes, record.brief, ...record.attendees]),
    transcript: spokenTranscript(record.transcript ?? ''),
  };
}

export function foldSearchText(text: MeetingSearchText): MeetingSearchText {
  return {
    title: foldText(text.title),
    summary: foldText(text.summary),
    notes: foldText(text.notes),
    transcript: foldText(text.transcript),
  };
}

/**
 * The field to open for a meeting that holds every word somewhere: the one with the most of them,
 * the earlier one on a tie. Null when a word is nowhere.
 */
export function bestField(folded: MeetingSearchText, words: readonly string[]): SearchField | null {
  const allInOne = SEARCH_FIELDS.find((field) => hasAllWords(folded[field], words));
  if (allInOne) return allInOne;
  const found = new Set<string>();
  let best: SearchField | null = null;
  let bestCount = 0;
  for (const field of SEARCH_FIELDS) {
    const inField = words.filter((word) => folded[field].includes(word));
    for (const word of inField) found.add(word);
    if (inField.length > bestCount) {
      best = field;
      bestCount = inField.length;
    }
  }
  return found.size === new Set(words).size ? best : null;
}

function firstOffset(folded: string, words: readonly string[]): number {
  let first = -1;
  for (const word of words) {
    const at = folded.indexOf(word);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  return first;
}

/**
 * One line of the original text around the first word. Folding keeps offsets, so what was found in
 * the folded copy is cut from the original with its accents and case intact.
 */
export function searchSnippet(original: string, words: readonly string[]): string | null {
  const inText = firstOffset(foldText(original), words);
  if (inText === -1) return null;
  const nextBreak = original.indexOf('\n', inText);
  const line = plainMarkdownLine(
    original.slice(
      original.lastIndexOf('\n', inText) + 1,
      nextBreak === -1 ? original.length : nextBreak,
    ),
  ).replace(/\s+/g, ' ');
  const at = firstOffset(foldText(line), words);
  if (at === -1) return null;

  const before = cutTail(line.slice(0, at), SNIPPET_LEAD);
  const after = cutPrefix(line.slice(at), SNIPPET_MAX_LENGTH - before.length);
  const lead = before.length < at ? '…' : '';
  const tail = at + after.length < line.length ? '…' : '';
  return `${lead}${before}${after}${tail}`;
}

interface Match {
  readonly body: MeetingBody;
  readonly field: SearchField;
}

async function snippetFor(match: Match, words: readonly string[]): Promise<string | null> {
  if (match.field === 'title') return null;
  const original = await match.body.original();
  return original === null ? null : searchSnippet(original[match.field], words);
}

/**
 * Every meeting holding all the words, newest first. Null when `isStale` turned true: the source
 * is closed between files, so a superseded search stops reading.
 */
export async function searchMeetings(input: {
  readonly bodies: AsyncIterable<MeetingBody>;
  readonly query: string;
  readonly isStale: () => boolean;
}): Promise<readonly SearchHit[] | null> {
  const words = foldedWords(input.query);
  if (input.query.trim().length < MIN_SEARCH_CHARS) return [];

  const matches: Match[] = [];
  for await (const body of input.bodies) {
    if (input.isStale()) return null;
    const field = bestField(body.folded, words);
    if (field !== null) matches.push({ body, field });
  }
  matches.sort((a, b) => meetingInstant(b.body.item) - meetingInstant(a.body.item));

  const snippets = new Map<number, string | null>();
  const withSnippet = Math.min(matches.length, MAX_ORIGINAL_SNIPPETS);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < withSnippet; index = next++) {
      if (input.isStale()) return;
      const match = matches[index];
      if (match) snippets.set(index, await snippetFor(match, words));
    }
  };
  await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
  if (input.isStale()) return null;

  return matches.map((match, index) => ({
    meetingId: match.body.item.id,
    field: match.field,
    snippet: snippets.get(index) ?? null,
  }));
}
