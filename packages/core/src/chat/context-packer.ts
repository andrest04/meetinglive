import type { FolderRecord } from '../library/folder';
import type { MeetingRecord } from '../library/meeting';
import { parseOffsetDate } from '../library/offset-date';
import type { ChatScopeKind } from './scope-resolver';
import { cutPrefix, cutTail } from './text-cut';

export const LIVE_TRANSCRIPT_MAX_CHARS = 2500;
export const MEETING_TRANSCRIPT_MAX_CHARS = 6000;
export const SUMMARY_MAX_CHARS = 800;
export const NOTES_MAX_CHARS = 400;
export const MEETING_CAP = 12;

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

function sharedBlock(
  m: ContextMeeting,
  summaryMax: number | null,
  notesMax: number | null,
): string {
  const cap = (value: string | null, max: number | null): string =>
    max === null ? (isBlank(value) ? NONE : neutralizeStructure(value)) : capPrefix(value, max);
  let out = '';
  out += `Id: ${compactMeetingId(m.id)}${NL}`;
  out += `Title: ${singleLine(m.title)}${NL}`;
  out += `Recorded: ${formatRecorded(m.recordedAt)}${NL}`;
  out += `Summary: ${cap(m.summary, summaryMax)}${NL}`;
  out += `Action items:${NL}`;
  const items = m.actionItems.filter((item) => !isBlank(item.text));
  if (items.length === 0) out += `${NONE}${NL}`;
  else
    for (const item of items) out += `- [${item.isDone ? 'x' : ' '}] ${singleLine(item.text)}${NL}`;
  out += `Notes: ${cap(m.notes, notesMax)}${NL}`;
  return out;
}

function packMany(
  kind: 'Folder' | 'AllMeetings',
  folderId: string | null,
  meetings: readonly ContextMeeting[],
  folders: readonly ContextFolder[],
  t: ChatStringLookup,
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
    out += sharedBlock(m, SUMMARY_MAX_CHARS, NOTES_MAX_CHARS);
  });
  return out.trimEnd();
}

/**
 * The only meeting text the model sees (spec 3.3). Pure: `liveTranscript` is an argument so the
 * caller snapshots it when the send starts (B5), and `t` supplies the CoreStrings messages.
 * Throws TypeError for null meetings or folders and RangeError for an unknown scope.
 */
export function packContext(
  kind: ChatScopeKind,
  folderId: string | null,
  meetingId: string | null,
  liveTranscript: string | null | undefined,
  meetings: readonly ContextMeeting[] | null,
  folders: readonly ContextFolder[] | null,
  t: ChatStringLookup,
): string {
  if (meetings === null) throw new TypeError('meetings is required');
  if (folders === null) throw new TypeError('folders is required');
  switch (kind) {
    case 'Live': {
      const text = tail(liveTranscript, LIVE_TRANSCRIPT_MAX_CHARS);
      if (text === null) return t('ChatLiveTranscriptEmpty');
      return `Live transcript:${NL}${neutralizeStructure(text)}`;
    }
    case 'Meeting': {
      const key = meetingId === null ? null : guidKey(meetingId);
      const found = key === null ? undefined : meetings.find((m) => guidKey(m.id) === key);
      if (!found) return t('ChatMeetingNotFound');
      let out = sharedBlock(found, null, null);
      const text = tail(found.transcript, MEETING_TRANSCRIPT_MAX_CHARS);
      out +=
        text === null
          ? `${t('ChatTranscriptEmpty')}${NL}`
          : `Transcript:${NL}${neutralizeStructure(text)}${NL}`;
      return out.trimEnd();
    }
    case 'Folder':
    case 'AllMeetings':
      return packMany(kind, folderId, meetings, folders, t);
    default:
      throw new RangeError(`Unknown chat scope: ${String(kind)}`);
  }
}
