import type { FolderRecord } from '../library/folder';
import type { MeetingRecord } from '../library/meeting';
import { parseOffsetDate } from '../library/offset-date';
import type { ProviderId } from '../summaries/provider';
import type { ChatScopeKind } from './scope-resolver';
import { cutPrefix, cutTail } from './text-cut';
import { selectExcerpts } from './transcript-retrieval';

export const LIVE_TRANSCRIPT_MAX_CHARS = 2500;
/** Local engine: the whole Meeting block (summary, notes, transcript) stays under this. */
export const MEETING_TRANSCRIPT_MAX_CHARS = 6000;
export const SUMMARY_MAX_CHARS = 800;
export const NOTES_MAX_CHARS = 400;
export const MEETING_CAP = 12;

/**
 * How much meeting text one send may carry, chosen by engine (T2). `meetingChars` caps the whole
 * Meeting scope block; `summaryChars` caps each summary in Folder and All meetings.
 */
export interface ContextBudget {
  /** Live tail when no rolling digest exists yet. */
  readonly liveChars: number;
  /** Live tail next to a rolling digest: the digest covers what came before (T2). */
  readonly liveTailWithDigestChars: number;
  /** The take's notes in Live scope. */
  readonly liveNotesChars: number;
  readonly meetingChars: number;
  readonly summaryChars: number;
}

/**
 * Local llama has 4096 tokens for prompt and reply. ~6000 chars of stamped transcript is about
 * 2000-2400 tokens; with ~300 tokens of instructions it leaves 1300+ tokens for the answer.
 */
export const LOCAL_CONTEXT_BUDGET: ContextBudget = {
  liveChars: LIVE_TRANSCRIPT_MAX_CHARS,
  liveTailWithDigestChars: LIVE_TRANSCRIPT_MAX_CHARS,
  liveNotesChars: NOTES_MAX_CHARS,
  meetingChars: MEETING_TRANSCRIPT_MAX_CHARS,
  summaryChars: SUMMARY_MAX_CHARS,
};

/** Claude Code and Codex: 120k chars is about 30-45k tokens, far below their windows. */
export const CLI_CONTEXT_BUDGET: ContextBudget = {
  liveChars: 20_000,
  /** About 3 minutes of speech, on top of the digest. */
  liveTailWithDigestChars: 8000,
  liveNotesChars: 2000,
  meetingChars: 120_000,
  summaryChars: 2000,
};

/** CLI engines get the large budget; local, or an engine that does not say, the small one. */
export const contextBudgetFor = (providerId: ProviderId | undefined): ContextBudget =>
  providerId === 'claude-code' || providerId === 'codex'
    ? CLI_CONTEXT_BUDGET
    : LOCAL_CONTEXT_BUDGET;

export interface PackOptions {
  /** Defaults to the local budget. */
  readonly budget?: ContextBudget;
  /** What the user asked: ranks transcript windows when the transcript does not fit. */
  readonly query?: string;
}

/**
 * What the chat knows about the take being recorded, fixed when the send starts (B5): the
 * committed transcript, the rolling digest and the session context (title and notes).
 */
export interface LiveContextSnapshot {
  readonly transcript: string | null;
  readonly digest?: string | null;
  readonly title?: string | null;
  readonly notes?: string | null;
}

/** Heads the rolling digest in Live scope; the model learns it may lag the tail. */
export const LIVE_DIGEST_LABEL =
  'Running summary of the recording so far (written during the recording, may lag the latest minutes):';
/** The digest never takes more than this, whatever the caller passes. */
const LIVE_DIGEST_MAX_CHARS = 1500;

/** Heads the transcript section when only parts of it fit. Also tells the model they are parts. */
export const TRANSCRIPT_EXCERPTS_LABEL =
  'Transcript excerpts (partial; if the answer may be elsewhere in the recording, say so):';

/** Shares of the Meeting budget the summary and the notes may take; the rest is transcript. */
const MEETING_SUMMARY_SHARE = 0.3;
const MEETING_NOTES_SHARE = 0.1;
/** The transcript always gets at least this share, even after a long action item list. */
const MEETING_TRANSCRIPT_MIN_SHARE = 0.3;

/** Only these fields can reach the model (spec 3.3). */
export type ContextMeeting = Pick<
  MeetingRecord,
  'id' | 'title' | 'recordedAt' | 'folderId' | 'summary' | 'notes' | 'transcript' | 'actionItems'
>;
export type ContextFolder = Pick<FolderRecord, 'id' | 'name' | 'note'>;

/** String lookup injected by the caller so core stays pure (CoreStrings keys). */
export type ChatStringLookup = (key: string) => string;

const NL = '\n';
const NONE = '(none)';
const LINE_BREAK = /\r\n|[\r\n\u0085\u2028\u2029]/g;

const isBlank = (value: string | null | undefined): value is null | undefined =>
  value === null || value === undefined || value.trim() === '';

/** Guid equality as C# sees it: case, hyphens and braces do not matter. */
const guidKey = (id: string): string => id.replace(/[-{}]/g, '').toLowerCase();

/** Id as 32 lowercase hex digits, no hyphens (the citation form). */
export const compactMeetingId = (id: string): string => guidKey(id);

/**
 * B12 rule. Meeting text is untrusted and is placed inside a line-oriented context. A line of
 * free text (summary, notes, transcript) is neutralized by prefixing "> " when, ignoring leading
 * spaces and tabs, it starts with `Id` + optional spaces + `:` (any case) or with a single `#`
 * followed by a space, a tab or the end of the line. Those are the only line shapes that
 * the context block (`Id:`) and the prompt (`# Context`, `# Prior turns`, `# User message`) use as
 * structure. `##` and deeper headings are left alone so Markdown summaries keep their layout.
 * Line endings in these fields are normalized to "\n". Callers cap length first; the "> " prefix
 * adds two units to an affected line.
 */
const FORGED_STRUCTURE = /^[ \t]*(?:Id[ \t]*:|#(?:[ \t]|$))/i;

export function neutralizeStructure(text: string): string {
  return text
    .split(LINE_BREAK)
    .map((line) => (FORGED_STRUCTURE.test(line) ? `> ${line}` : line))
    .join(NL);
}

/** B12: single-line fields lose their line breaks (each break becomes one space). */
export const singleLine = (text: string): string => text.replace(LINE_BREAK, ' ');

const tail = (value: string | null | undefined, max: number): string | null =>
  isBlank(value) ? null : cutTail(value, max);

const capPrefix = (value: string | null | undefined, max: number): string =>
  isBlank(value) ? NONE : neutralizeStructure(cutPrefix(value, max));

const pad = (n: number): string => String(n).padStart(2, '0');

/** `yyyy-MM-dd HH:mm` in the machine's local time. Never the ISO "O" form. */
function formatRecorded(recordedAt: string): string {
  const parsed = parseOffsetDate(recordedAt);
  if (!parsed) return singleLine(recordedAt);
  const d = new Date(parsed.ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function recordedMs(recordedAt: string): number {
  return parseOffsetDate(recordedAt)?.ms ?? Number.NEGATIVE_INFINITY;
}

function sharedBlock(m: ContextMeeting, summaryMax: number, notesMax: number): string {
  let out = '';
  out += `Id: ${compactMeetingId(m.id)}${NL}`;
  out += `Title: ${singleLine(m.title)}${NL}`;
  out += `Recorded: ${formatRecorded(m.recordedAt)}${NL}`;
  out += `Summary: ${capPrefix(m.summary, summaryMax)}${NL}`;
  out += `Action items:${NL}`;
  const items = m.actionItems.filter((item) => !isBlank(item.text));
  if (items.length === 0) out += `${NONE}${NL}`;
  else
    for (const item of items) out += `- [${item.isDone ? 'x' : ' '}] ${singleLine(item.text)}${NL}`;
  out += `Notes: ${capPrefix(m.notes, notesMax)}${NL}`;
  return out;
}

function packMany(
  kind: 'Folder' | 'AllMeetings',
  folderId: string | null,
  meetings: readonly ContextMeeting[],
  folders: readonly ContextFolder[],
  t: ChatStringLookup,
  summaryMax: number,
): string {
  let out = '';
  if (kind === 'Folder') {
    if (folderId === null) return t('ChatFolderNotSelected');
    const key = guidKey(folderId);
    const found = folders.find((f) => guidKey(f.id) === key);
    if (!found) out += `${t('ChatFolderNotFound')}${NL}`;
    else {
      out += `Folder: ${singleLine(found.name)}${NL}`;
      out += `Note: ${isBlank(found.note) ? NONE : neutralizeStructure(found.note)}${NL}`;
    }
  } else {
    out += `All meetings:${NL}`;
  }

  const folderKey = folderId === null ? null : guidKey(folderId);
  const matching =
    kind === 'AllMeetings'
      ? [...meetings]
      : meetings.filter(
          (m) => folderKey !== null && m.folderId !== null && guidKey(m.folderId) === folderKey,
        );
  matching.sort((a, b) => {
    const diff = recordedMs(b.recordedAt) - recordedMs(a.recordedAt);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    const ia = compactMeetingId(a.id);
    const ib = compactMeetingId(b.id);
    return ia < ib ? 1 : ia > ib ? -1 : 0;
  });
  const selected = matching.slice(0, MEETING_CAP);

  if (selected.length === 0) {
    out += t(kind === 'Folder' ? 'ChatNoMeetingsInFolder' : 'ChatNoMeetingsSaved');
    return out.trimEnd();
  }
  if (selected.length < matching.length) {
    out += `Showing the ${MEETING_CAP} most recent of ${matching.length} meetings. Older meetings were omitted.${NL}`;
  }
  selected.forEach((m, index) => {
    if (index > 0) out += NL;
    out += sharedBlock(m, summaryMax, NOTES_MAX_CHARS);
  });
  return out.trimEnd();
}

/**
 * Meeting scope: the shared block, then the whole transcript when it fits in what the budget
 * leaves, else BM25-ranked excerpts plus the recent tail (`selectExcerpts`).
 */
function packMeeting(
  found: ContextMeeting,
  budget: ContextBudget,
  query: string,
  t: ChatStringLookup,
): string {
  const total = budget.meetingChars;
  let out = sharedBlock(
    found,
    Math.floor(total * MEETING_SUMMARY_SHARE),
    Math.floor(total * MEETING_NOTES_SHARE),
  );
  if (isBlank(found.transcript)) return `${out}${t('ChatTranscriptEmpty')}`.trimEnd();
  // Neutralized first, so the budget counts the text exactly as the model will see it.
  const transcript = neutralizeStructure(found.transcript);
  const fullRoom = total - out.length - 'Transcript:'.length - NL.length;
  if (transcript.length <= fullRoom) return `${out}Transcript:${NL}${transcript}`.trimEnd();
  const room = Math.max(
    total - out.length - TRANSCRIPT_EXCERPTS_LABEL.length - NL.length,
    Math.floor(total * MEETING_TRANSCRIPT_MIN_SHARE),
  );
  out += `${TRANSCRIPT_EXCERPTS_LABEL}${NL}${selectExcerpts(transcript, query, room)}`;
  return out.trimEnd();
}

/**
 * Live scope (T2): the session context (title, notes), the rolling digest when there is one, then
 * the recent tail of the live transcript. With a digest the tail is shorter, since the digest
 * covers what came before; without one the tail keeps the full live budget.
 */
function packLive(live: LiveContextSnapshot, budget: ContextBudget, t: ChatStringLookup): string {
  const digest = isBlank(live.digest) ? null : cutPrefix(live.digest, LIVE_DIGEST_MAX_CHARS);
  const text = tail(
    live.transcript,
    digest === null ? budget.liveChars : budget.liveTailWithDigestChars,
  );
  if (text === null && digest === null) return t('ChatLiveTranscriptEmpty');
  const parts: string[] = [];
  const session: string[] = [];
  if (!isBlank(live.title)) session.push(`Meeting: ${singleLine(live.title.trim())}`);
  if (!isBlank(live.notes)) session.push(`Notes: ${capPrefix(live.notes, budget.liveNotesChars)}`);
  if (session.length > 0) parts.push(session.join(NL));
  if (digest !== null) parts.push(`${LIVE_DIGEST_LABEL}${NL}${neutralizeStructure(digest)}`);
  if (text !== null) parts.push(`Live transcript:${NL}${neutralizeStructure(text)}`);
  return parts.join(`${NL}${NL}`);
}

/**
 * The only meeting text the model sees (spec 3.3). Pure: `liveTranscript` is an argument so the
 * caller snapshots it when the send starts (B5), and `t` supplies the CoreStrings messages.
 * `options.budget` sizes the text for the engine (T2); `options.query` ranks transcript excerpts.
 * Throws TypeError for null meetings or folders and RangeError for an unknown scope.
 */
export function packContext(
  kind: ChatScopeKind,
  folderId: string | null,
  meetingId: string | null,
  liveTranscript: string | LiveContextSnapshot | null | undefined,
  meetings: readonly ContextMeeting[] | null,
  folders: readonly ContextFolder[] | null,
  t: ChatStringLookup,
  options: PackOptions = {},
): string {
  const budget = options.budget ?? LOCAL_CONTEXT_BUDGET;
  if (meetings === null) throw new TypeError('meetings is required');
  if (folders === null) throw new TypeError('folders is required');
  switch (kind) {
    case 'Live':
      return packLive(
        typeof liveTranscript === 'string' || liveTranscript == null
          ? { transcript: liveTranscript ?? null }
          : liveTranscript,
        budget,
        t,
      );
    case 'Meeting': {
      const key = meetingId === null ? null : guidKey(meetingId);
      const found = key === null ? undefined : meetings.find((m) => guidKey(m.id) === key);
      if (!found) return t('ChatMeetingNotFound');
      return packMeeting(found, budget, options.query ?? '', t);
    }
    case 'Folder':
    case 'AllMeetings':
      return packMany(kind, folderId, meetings, folders, t, budget.summaryChars);
    default:
      throw new RangeError(`Unknown chat scope: ${String(kind)}`);
  }
}
