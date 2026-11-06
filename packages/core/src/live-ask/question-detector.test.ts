import { describe, expect, it } from 'vitest';
import { formatEnded, formatHeader, formatLine } from '../transcription/stamp-format';
import { NEMOTRON_EN_LINES, NEMOTRON_ES_LINES } from './fixtures/nemotron-live-lines';
import { detectNewQuestion, questionKey } from './question-detector';

/** Ported from MeetingLive.Core.Tests/Services/LiveQuestionDetectorTests.cs, plus es/en extras. */

const AGILE_ES = '¿Cuál es el tercer principio del manifiesto ágil?';
const AGILE_EN = 'what is the third principle of the agile manifesto?';
const none = new Set<string>();
const body = (previous: string | null, current: string | null, seen = none) =>
  detectNewQuestion(previous, current, seen)?.body ?? null;

describe('detectNewQuestion (WinUI LiveQuestionDetector cases)', () => {
  it('returns the body of a new Spanish question under the headers', () => {
    const current = [
      formatHeader(Date.UTC(2026, 8, 21, 15)),
      formatEnded(Date.UTC(2026, 8, 21, 16)),
      formatLine(0, 8000, AGILE_ES),
    ].join('\n');
    expect(detectNewQuestion(null, current, none)).toEqual({
      body: AGILE_ES,
      lineStartMs: 0,
      key: questionKey(AGILE_ES),
    });
  });

  it('ignores a question that was already committed', () => {
    const line = formatLine(0, 8000, AGILE_ES);
    expect(body(line, line)).toBeNull();
  });

  it('returns an English question', () => {
    const line = formatLine(12_000, 20_000, AGILE_EN);
    expect(detectNewQuestion('', line, none)).toMatchObject({
      body: AGILE_EN,
      lineStartMs: 12_000,
    });
  });

  it.each(['¿se entiende?', '¿ok?', 'right?', 'does that make sense?'])(
    'rejects the rhetorical check %s',
    (phrase) => {
      expect(body(null, formatLine(0, 3000, phrase))).toBeNull();
    },
  );

  it('rejects a body shorter than twelve characters once normalized', () => {
    expect(body(null, formatLine(0, 2000, '¿qué hora?'))).toBeNull();
  });

  it('drops the speaker tag from the body', () => {
    const detected = body(null, formatLine(4000, 9000, AGILE_ES, 2));
    expect(detected).toBe(AGILE_ES);
    expect(detected).not.toContain('Speaker');
  });

  it('ignores the Recorded and Ended headers', () => {
    expect(body(null, `Recorded ${AGILE_EN}`)).toBeNull();
    expect(body(null, `Ended ${AGILE_EN}`)).toBeNull();
  });

  it('returns the last of several new questions', () => {
    const current = [
      formatLine(1000, 4000, 'what is the first principle of the agile manifesto?'),
      formatLine(5000, 9000, AGILE_EN),
    ].join('\n');
    expect(body(null, current)).toBe(AGILE_EN);
  });

  it('keeps a longer question that only contains a rhetorical word', () => {
    const text = '¿no es ese el tercer principio del manifiesto ágil?';
    expect(body(null, formatLine(2000, 7000, text))).toBe(text);
  });

  it('accepts a line that starts with an interrogative and has no question mark', () => {
    const en = 'what is the third principle of the agile manifesto';
    const es = 'por qué es importante el tercer principio del manifiesto';
    expect(body(null, formatLine(1000, 6000, en))).toBe(en);
    expect(body(null, formatLine(7000, 12_000, es))).toBe(es);
  });

  it('rejects a line that starts with "Porque"', () => {
    const line = formatLine(1000, 6000, 'Porque el manifiesto ágil prioriza software funcionando');
    expect(body(null, line)).toBeNull();
  });

  it('returns null for null, empty, unchanged, statements and broken stamps', () => {
    const statement = formatLine(0, 3000, 'the third principle is deliver working software');
    expect(body(null, null)).toBeNull();
    expect(body('', '')).toBeNull();
    expect(body(statement, statement)).toBeNull();
    expect(body(null, statement)).toBeNull();
    expect(body(null, '[not-a-stamp\n¿\n???')).toBeNull();
  });
});

describe('detectNewQuestion (port extras)', () => {
  it('accepts "por que" without the accent, as ASR often drops it', () => {
    const text = 'por que no usamos el mismo proveedor que el año pasado';
    expect(body(null, formatLine(0, 4000, text))).toBe(text);
  });

  it('accepts a long statement with a "¿no?" tail', () => {
    const text = 'entonces la entrega queda para el viernes, ¿no?';
    expect(body(null, formatLine(0, 4000, text))).toBe(text);
  });

  it.each([
    '¿me escuchan bien?',
    'can you hear me?',
    'is that clear?',
    'you know what I mean?',
    '¿me entienden?',
    '¿está claro?',
  ])('rejects the extra rhetorical check %s', (phrase) => {
    expect(body(null, formatLine(0, 3000, phrase))).toBeNull();
  });

  it('skips a question whose key is in the seen set and keeps looking', () => {
    const current = [
      formatLine(1000, 4000, 'what is the first principle of the agile manifesto?'),
      formatLine(5000, 9000, AGILE_EN),
    ].join('\n');
    const seen = new Set([questionKey(AGILE_EN)]);
    expect(body(null, current, seen)).toBe('what is the first principle of the agile manifesto?');
  });

  it('treats punctuation, case and spacing variants as the same seen question', () => {
    expect(questionKey('¿Cuál es  el tercer principio?')).toBe(
      questionKey('cuál es el tercer principio'),
    );
  });

  it('prefers the last new question with a second-person cue over a later one without', () => {
    const current = [
      formatLine(1000, 4000, '¿Puedes contarnos cómo vas con el informe?'),
      formatLine(5000, 9000, 'qué pasó con el servidor de pruebas ayer'),
    ].join('\n');
    expect(body(null, current)).toBe('¿Puedes contarnos cómo vas con el informe?');
  });

  it.each([
    "what's the budget for the third quarter",
    'how’s the migration going this week',
    "who's taking the notes for the retro",
  ])('accepts an English contraction opener without a question mark: %s', (text) => {
    expect(body(null, formatLine(0, 3000, text))).toBe(text);
  });

  it.each([
    'is the staging environment ready for testing',
    'do we have a timeline for the fix',
    'can you send the numbers before friday',
    'are they joining the call tomorrow',
  ])('accepts an English yes/no opener without a question mark: %s', (text) => {
    expect(body(null, formatLine(0, 3000, text))).toBe(text);
  });

  it.each([
    'do the review before the release',
    'could be the network again today',
    'will do that after the meeting ends',
  ])('rejects an auxiliary start that is not a question: %s', (text) => {
    expect(body(null, formatLine(0, 3000, text))).toBeNull();
  });

  it.each([
    'puedes enviarme el contrato mañana',
    'podrías revisar el documento hoy',
    'alguien puede organizar esa llamada',
    'alguien sabe dónde quedó el acta',
  ])('accepts a Spanish request opener without signs: %s', (text) => {
    expect(body(null, formatLine(0, 3000, text))).toBe(text);
  });

  it('rejects a Spanish statement that only mentions someone', () => {
    expect(body(null, formatLine(0, 3000, 'alguien me dijo que el servidor se cayó'))).toBeNull();
  });

  it('returns the line start of the detected question, starred lines included', () => {
    const line = `* ${formatLine(65_000, 70_000, AGILE_EN)}`;
    expect(detectNewQuestion(null, line, none)?.lineStartMs).toBe(65_000);
  });
});

describe('detectNewQuestion (real Nemotron live lines)', () => {
  it.each([...NEMOTRON_ES_LINES, ...NEMOTRON_EN_LINES])(
    '$line -> question $question',
    ({ line, question }) => {
      expect(detectNewQuestion(null, line, none) !== null).toBe(question);
    },
  );
});
