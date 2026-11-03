import { parseGuid, stringifyCompact, stripBom } from './dotnet-json';
import {
  MeetingFormatError,
  type ActionItem,
  type JevAnalysis,
  type JevActionVerdict,
  type MeetingRecord,
} from './meeting';
import { formatOffsetDate, normalizeOffsetDate, parseOffsetDate } from './offset-date';

const H_BRIEF = '## Brief';
const H_TRANSCRIPT = '## Transcript';
const H_SUMMARY = '## Summary';
const H_ACTIONS = '## Action Items';
const H_JEV = '## Jev';
const H_NOTES = '## Personal Notes';
const H_FOLLOW_UP = '## Follow-up';
const H_PLAN = '## Project plan';

const HEADERS: readonly string[] = [
  H_BRIEF,
  H_TRANSCRIPT,
  H_SUMMARY,
  H_ACTIONS,
  H_JEV,
  H_NOTES,
  H_FOLLOW_UP,
  H_PLAN,
];
const ESCAPE_SUFFIX = ' ##';

/** The file system as the parser needs it: only to find a recording next to the markdown. */
export interface MeetingFileProbe {
  fileExists(path: string): boolean;
}

/** `a.md` becomes `a.wav`. Works on any separator, with no Node dependency. */
export function siblingWavPath(markdownPath: string): string {
  return markdownPath.replace(/\.[^./\\]*$/, '') + '.wav';
}

const oneLine = (value: string): string => value.replace(/[\r\n]/g, ' ');

function isEscapable(line: string): boolean {
  let rest = line;
  while (rest.endsWith(ESCAPE_SUFFIX)) rest = rest.slice(0, -ESCAPE_SUFFIX.length);
  return HEADERS.includes(rest);
}

const present = (value: string | null): value is string => value !== null && value.trim() !== '';

// ---------------------------------------------------------------- render

function jevToJson(jev: JevAnalysis): string {
  const analyzed = parseOffsetDate(jev.analyzedAt);
  return stringifyCompact({
    meetingType: jev.meetingType,
    meetingTypeConfidence: jev.meetingTypeConfidence,
    spokenLanguage: jev.spokenLanguage,
    urgencyScore: jev.urgencyScore,
    urgencyConfidence: jev.urgencyConfidence,
    containsDecisions: jev.containsDecisions,
    containsCommitments: jev.containsCommitments,
    piiRisk: jev.piiRisk,
    summaryFaithful: jev.summaryFaithful,
    suggestedFolderId: jev.suggestedFolderId,
    folderConfidence: jev.folderConfidence,
    actionItems: jev.actionItems.map((a) => ({
      text: a.text,
      relation: a.relation,
      confidence: a.confidence,
    })),
    model: jev.model,
    analyzedAt: analyzed ? formatOffsetDate(analyzed, 'json') : jev.analyzedAt,
  });
}

/** Renders the exact file format of spec 3.8: LF endings, no BOM. */
export function renderMeetingMarkdown(record: MeetingRecord): string {
  const texts = [
    record.brief,
    record.transcript,
    record.summary,
    record.notes,
    record.followUp,
    record.projectPlan,
  ];
  const escaping = texts.some(
    (text) =>
      present(text) &&
      text
        .trim()
        .replace(/\r\n/g, '\n')
        .split('\n')
        .some((l) => HEADERS.includes(l)),
  );

  let out = '---\n';
  out += `id: ${parseGuid(record.id) ?? record.id}\n`;
  out += `title: ${oneLine(record.title)}\n`;
  out += `recordedAt: ${normalizeOffsetDate(record.recordedAt) ?? record.recordedAt}\n`;
  if (record.endedAt) out += `endedAt: ${normalizeOffsetDate(record.endedAt) ?? record.endedAt}\n`;
  out += `audioFilePath: ${oneLine(record.audioFilePath)}\n`;
  if (record.folderId) out += `folderId: ${parseGuid(record.folderId) ?? record.folderId}\n`;
  if (record.summaryProvider) out += `summaryProvider: ${oneLine(record.summaryProvider)}\n`;
  const optional: readonly (readonly [string, string | null])[] = [
    ['calendarEventId', record.calendarEventId],
    ['calendarId', record.calendarId],
    ['seriesId', record.seriesId],
    ['joinUrl', record.joinUrl],
    ['noteTemplateId', record.noteTemplateId],
  ];
  for (const [key, value] of optional) {
    if (present(value)) out += `${key}: ${oneLine(value)}\n`;
  }
  if (record.attendees.length > 0)
    out += `attendees: ${record.attendees.map(oneLine).join(' | ')}\n`;
  if (escaping) out += 'headerEscaping: 1\n';
  out += '---\n';

  const body = (text: string): string => {
    const trimmed = text.trim();
    if (!escaping) return trimmed;
    return trimmed
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => (isEscapable(line) ? line + ESCAPE_SUFFIX : line))
      .join('\n');
  };
  const section = (header: string, text: string | null): void => {
    if (present(text)) out += `\n${header}\n\n${body(text)}\n`;
  };

  section(H_BRIEF, record.brief);
  section(H_TRANSCRIPT, record.transcript);
  section(H_SUMMARY, record.summary);
  if (record.actionItems.length > 0) {
    out += `\n${H_ACTIONS}\n\n`;
    for (const item of record.actionItems) {
      out += `- [${item.isDone ? 'x' : ' '}] ${oneLine(item.text)}\n`;
    }
  }
  if (record.jevAnalysis) out += `\n${H_JEV}\n\n${jevToJson(record.jevAnalysis)}\n`;
  section(H_NOTES, record.notes);
  section(H_FOLLOW_UP, record.followUp);
  section(H_PLAN, record.projectPlan);
  return out;
}

// ----------------------------------------------------------------- parse

function readFrontmatter(lines: readonly string[]): {
  map: Map<string, string>;
  bodyStart: number;
} {
  if (lines[0] !== '---') throw new MeetingFormatError('The file does not start with "---".');
  const map = new Map<string, string>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line === '---') return { map, bodyStart: i + 1 };
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    map.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  throw new MeetingFormatError('The frontmatter has no closing "---".');
}

function extractSection(body: readonly string[], header: string): string | null {
  const start = body.indexOf(header);
  if (start < 0) return null;
  const content: string[] = [];
  for (let i = start + 1; i < body.length; i += 1) {
    const line = body[i] ?? '';
    if (line !== header && HEADERS.includes(line)) break;
    content.push(line);
  }
  const text = content.join('\n').trim();
  return text === '' ? null : text;
}

function unescapeText(text: string | null, active: boolean): string | null {
  if (text === null || !active) return text;
  return text
    .split('\n')
    .map((line) =>
      line.endsWith(ESCAPE_SUFFIX) && isEscapable(line)
        ? line.slice(0, -ESCAPE_SUFFIX.length)
        : line,
    )
    .join('\n');
}

const ACTION_ITEM = /^\s*-\s\[( |x|X)\]\s+(.*)$/;

function parseActionItems(text: string | null): ActionItem[] {
  if (text === null) return [];
  const items: ActionItem[] = [];
  for (const line of text.split('\n')) {
    const match = ACTION_ITEM.exec(line);
    if (match) items.push({ text: (match[2] ?? '').trim(), isDone: match[1] !== ' ' });
  }
  return items;
}

type Json = Record<string, unknown>;

function lowerKeys(value: unknown): Json {
  const out: Json = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value)) out[key.toLowerCase()] = v;
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function parseJev(text: string): JevAnalysis {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MeetingFormatError('The "## Jev" block is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MeetingFormatError('The "## Jev" block is not a JSON object.');
  }
  const o = lowerKeys(raw);
  const items = Array.isArray(o.actionitems) ? (o.actionitems as unknown[]) : [];
  const actionItems: JevActionVerdict[] = items.map((item) => {
    const a = lowerKeys(item);
    return {
      text: str(a.text) ?? '',
      relation: str(a.relation) ?? '',
      confidence: num(a.confidence),
    };
  });
  const analyzed = str(o.analyzedat);
  const parsed = analyzed === null ? null : parseOffsetDate(analyzed);
  return {
    meetingType: str(o.meetingtype),
    meetingTypeConfidence: num(o.meetingtypeconfidence),
    spokenLanguage: str(o.spokenlanguage),
    urgencyScore: num(o.urgencyscore) ?? 0,
    urgencyConfidence: num(o.urgencyconfidence),
    containsDecisions: num(o.containsdecisions) ?? 0,
    containsCommitments: num(o.containscommitments) ?? 0,
    piiRisk: num(o.piirisk) ?? 0,
    summaryFaithful: num(o.summaryfaithful),
    suggestedFolderId: str(o.suggestedfolderid),
    folderConfidence: num(o.folderconfidence),
    actionItems,
    model: str(o.model) ?? '',
    analyzedAt: parsed
      ? formatOffsetDate(parsed, 'json')
      : (analyzed ?? '0001-01-01T00:00:00+00:00'),
  };
}

/**
 * Parses a meeting file (spec 3.9). Throws MeetingFormatError for a file that is not a meeting;
 * callers skip such files rather than failing the whole library.
 */
export function parseMeetingMarkdown(
  path: string,
  markdown: string,
  files: MeetingFileProbe,
): MeetingRecord {
  const lines = stripBom(markdown).replace(/\r\n/g, '\n').split('\n');
  const { map, bodyStart } = readFrontmatter(lines);

  const id = parseGuid(map.get('id'));
  if (id === null) throw new MeetingFormatError('The "id" is missing or not a GUID.');
  const recordedText = map.get('recordedAt');
  const recordedAt = recordedText === undefined ? null : normalizeOffsetDate(recordedText);
  if (recordedAt === null) throw new MeetingFormatError('"recordedAt" is missing or not a date.');
  const endedText = map.get('endedAt');
  const endedAt = endedText ? normalizeOffsetDate(endedText) : null;

  let audioFilePath = map.get('audioFilePath') ?? '';
  const sibling = siblingWavPath(path);
  if ((audioFilePath === '' || !files.fileExists(audioFilePath)) && files.fileExists(sibling)) {
    audioFilePath = sibling;
  }

  const optional = (key: string): string | null => {
    const value = map.get(key);
    return value === undefined || value.trim() === '' ? null : value;
  };

  const body = lines.slice(bodyStart);
  const escaped = map.has('headerEscaping');
  const text = (header: string): string | null =>
    unescapeText(extractSection(body, header), escaped);
  const jevBody = extractSection(body, H_JEV);

  return {
    id,
    title: map.get('title') ?? '',
    recordedAt,
    endedAt,
    audioFilePath,
    sourcePath: path,
    folderId: parseGuid(map.get('folderId')),
    summaryProvider: optional('summaryProvider'),
    calendarEventId: optional('calendarEventId'),
    calendarId: optional('calendarId'),
    seriesId: optional('seriesId'),
    joinUrl: optional('joinUrl'),
    noteTemplateId: optional('noteTemplateId'),
    attendees: (map.get('attendees') ?? '')
      .split(' | ')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
    brief: text(H_BRIEF),
    transcript: text(H_TRANSCRIPT),
    summary: text(H_SUMMARY),
    actionItems: parseActionItems(extractSection(body, H_ACTIONS)),
    jevAnalysis: jevBody === null ? null : parseJev(jevBody),
    notes: text(H_NOTES),
    followUp: text(H_FOLLOW_UP),
    projectPlan: text(H_PLAN),
  };
}
