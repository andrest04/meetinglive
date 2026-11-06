import {
  extractCommittedBody,
  isTranscriptHeader,
  parseCommittedLineStart,
  splitCommittedLines,
} from '../transcription/committed-line';

/**
 * Finds a newly committed direct question (port of WinUI `LiveQuestionDetector`). Pure: the
 * caller keeps the previous committed text and the keys it has already shown or dismissed.
 *
 * A line counts when it has `¿`, ends with `?`, or starts with an interrogative word ("por qué"
 * and "por que" included, "porque" not), is at least 12 characters once normalized, and is not a
 * whole-line rhetorical check ("¿se entiende?", "right?"). Of several new questions the last one
 * wins; a second-person cue ("¿puedes…?", "can you…") only breaks that tie, it never rejects.
 */

const MINIMUM_NORMALIZED_LENGTH = 12;

const INTERROGATIVE_WORDS: ReadonlySet<string> = new Set([
  'qué',
  'cómo',
  'como',
  'cuál',
  'cual',
  'cuáles',
  'cuales',
  'cuándo',
  'cuando',
  'dónde',
  'donde',
  'quién',
  'quien',
  'quiénes',
  'quienes',
  // Port extra: only the accented forms, "cuanto antes" starts statements.
  'cuánto',
  'cuánta',
  'cuántos',
  'cuántas',
  'what',
  'how',
  'why',
  'when',
  'where',
  'who',
  'which',
]);

/** "por qué" is WinUI; "por que" is a port extra (ASR drops the accent). "porque" never counts. */
const INTERROGATIVE_PHRASES: readonly string[] = ['por qué', 'por que'];

const RHETORICAL_BODIES: ReadonlySet<string> = new Set([
  // WinUI list.
  'se entiende',
  'ok',
  'okay',
  'verdad',
  'no',
  'claro',
  'me explico',
  'me seguis',
  'me seguís',
  'me siguen',
  'right',
  'does that make sense',
  'make sense',
  'got it',
  'entendido',
  'si',
  'sí',
  'dale',
  'todo bien',
  'listo',
  'estan',
  'están',
  // Port extras: checks that the room follows or hears, not questions that expect an answer.
  'me escuchan',
  'me escuchan bien',
  'se escucha',
  'se escucha bien',
  'me oyen',
  'me oyen bien',
  'me entienden',
  'me entendés',
  'me entiendes',
  'me explico bien',
  'está claro',
  'esta claro',
  'quedó claro',
  'quedo claro',
  'de acuerdo',
  'no es cierto',
  'cierto',
  'vale',
  'alguna duda',
  'alguna pregunta',
  'can you hear me',
  'can everyone hear me',
  'can you see my screen',
  'is that clear',
  'you know',
  'you know what i mean',
  'know what i mean',
  'see what i mean',
  'makes sense',
  'does it make sense',
  'any questions',
  'are we good',
  'sounds good',
  'correct',
]);

const SECOND_PERSON_CUES: ReadonlySet<string> = new Set([
  'you',
  'your',
  'puedes',
  'podés',
  'podrías',
  'podrias',
  'pueden',
  'podrían',
  'sabes',
  'sabés',
  'saben',
  'tienes',
  'tenés',
  'tienen',
  'usted',
  'ustedes',
  'vos',
  'tú',
]);

const EDGE_PUNCTUATION = new Set([
  '¿',
  '?',
  '!',
  '¡',
  '.',
  ',',
  ';',
  ':',
  '"',
  "'",
  '“',
  '”',
  '‘',
  '’',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '…',
  '—',
  '–',
  '-',
  '«',
  '»',
]);

const PUNCTUATION_ANYWHERE = /[¿?!¡.,;:"'“”‘’()[\]{}…—–\-«»]/gu;

export interface DetectedQuestion {
  /** The spoken text of the line, without stamp, star or speaker tag. */
  readonly body: string;
  /** Start of the line in the take, or null when the stamp is missing. */
  readonly lineStartMs: number | null;
  /** The normalized form used by the seen and dismissed sets. */
  readonly key: string;
}

function trimEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && EDGE_PUNCTUATION.has(value.charAt(start))) start += 1;
  while (end > start && EDGE_PUNCTUATION.has(value.charAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

const collapseWhitespace = (value: string): string => value.split(/\s+/u).filter(Boolean).join(' ');

/** WinUI `Normalize`: trimmed, edge punctuation off, lower case, single spaces. */
function normalize(body: string): string {
  return collapseWhitespace(trimEdges(body.trim()).trim().toLowerCase());
}

/** The seen-set key: the normalized body with every punctuation mark removed. */
export function questionKey(body: string): string {
  return normalize(body.normalize('NFC').replace(PUNCTUATION_ANYWHERE, ' '));
}

function startsWithPhrase(normalized: string, phrase: string): boolean {
  if (!normalized.startsWith(phrase)) return false;
  if (normalized.length === phrase.length) return true;
  const next = normalized.charAt(phrase.length);
  return /\s/u.test(next) || EDGE_PUNCTUATION.has(next);
}

function startsWithInterrogative(body: string): boolean {
  const normalized = normalize(body);
  if (normalized === '') return false;
  if (INTERROGATIVE_PHRASES.some((phrase) => startsWithPhrase(normalized, phrase))) return true;
  const space = normalized.indexOf(' ');
  const first = trimEdges(space < 0 ? normalized : normalized.slice(0, space));
  return INTERROGATIVE_WORDS.has(first);
}

function hasQuestionSignal(trimmed: string): boolean {
  return trimmed.includes('¿') || trimmed.endsWith('?') || startsWithInterrogative(trimmed);
}

/** WinUI `IsDirectQuestion`. Whole-body rhetorical match only: "¿no es ese…?" still counts. */
export function isDirectQuestion(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed === '' || !hasQuestionSignal(trimmed)) return false;
  const normalized = normalize(trimmed);
  if (normalized.length < MINIMUM_NORMALIZED_LENGTH) return false;
  return !RHETORICAL_BODIES.has(normalized);
}

function hasSecondPersonCue(body: string): boolean {
  return normalize(body)
    .split(/[^\p{L}]+/u)
    .some((word) => SECOND_PERSON_CUES.has(word));
}

/**
 * The newest direct question among the lines of `current` that were not in `previous` and whose
 * key is not in `seen`. Null when there is none.
 */
export function detectNewQuestion(
  previous: string | null,
  current: string | null,
  seen: ReadonlySet<string>,
): DetectedQuestion | null {
  if (current === null || current === '' || previous === current) return null;
  const previousLines = new Set(splitCommittedLines(previous));
  let last: DetectedQuestion | null = null;
  let lastWithCue: DetectedQuestion | null = null;
  for (const line of splitCommittedLines(current)) {
    if (line === '' || previousLines.has(line) || isTranscriptHeader(line)) continue;
    const body = extractCommittedBody(line);
    if (!isDirectQuestion(body)) continue;
    const key = questionKey(body);
    if (seen.has(key)) continue;
    const found: DetectedQuestion = { body, lineStartMs: parseCommittedLineStart(line), key };
    last = found;
    if (hasSecondPersonCue(body)) lastWithCue = found;
  }
  return lastWithCue ?? last;
}
