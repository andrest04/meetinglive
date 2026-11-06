import { describe, expect, it } from 'vitest';
import {
  RETRIEVAL_TAIL_CHARS,
  scoreWindows,
  selectExcerpts,
  splitTranscriptWindows,
  tokenize,
} from './transcript-retrieval';

const pad = (n: number): string => String(n).padStart(2, '0');
const stamp = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}.${pad(Math.floor((ms % 1000) / 10))}`;
};
const line = (startMs: number, text: string, speaker = 1): string =>
  `[${stamp(startMs)}-${stamp(startMs + 4000)}] [ Speaker-${speaker} ] ${text}`;

const FILLER = [
  'we keep going with the next point of the agenda',
  'the team shared a quick status update',
  'someone asked about the schedule for next week',
  'there was a short pause while slides changed',
];

/** 38 minutes, one line every 5 s. Minute 10 talks about the budget of the campaign. */
function longTranscript(): string {
  const lines: string[] = [];
  for (let ms = 0; ms < 38 * 60_000; ms += 5000) {
    const minute = Math.floor(ms / 60_000);
    const text =
      minute === 10
        ? 'el presupuesto de la campaña sube a cuarenta mil dólares'
        : (FILLER[(ms / 5000) % FILLER.length] ?? '');
    lines.push(line(ms, text, (ms / 5000) % 3));
  }
  return lines.join('\n');
}

describe('splitTranscriptWindows', () => {
  it('groups stamped lines into ~90 s windows with their time range', () => {
    const text = [0, 30_000, 60_000, 95_000, 120_000, 170_000]
      .map((ms) => line(ms, 'x'))
      .join('\n');
    const windows = splitTranscriptWindows(text);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ startMs: 0, endMs: 64_000 });
    expect(windows[0]?.text.split('\n')).toHaveLength(3);
    expect(windows[1]).toMatchObject({ startMs: 95_000, endMs: 174_000 });
  });

  it('keeps unstamped lines inside the current window', () => {
    const text = [line(0, 'a'), 'continued text', line(100_000, 'b')].join('\n');
    const windows = splitTranscriptWindows(text);
    expect(windows).toHaveLength(2);
    expect(windows[0]?.text).toContain('continued text');
  });

  it('falls back to fixed-size character windows when no line has a stamp', () => {
    const text = Array.from({ length: 100 }, (_, i) => `plain line number ${String(i)}`).join('\n');
    const windows = splitTranscriptWindows(text, { fallbackChars: 300 });
    expect(windows.length).toBeGreaterThan(5);
    for (const w of windows) {
      expect(w.text.length).toBeLessThanOrEqual(300);
      expect(w.startMs).toBeNull();
    }
    expect(windows.map((w) => w.text).join('\n')).toBe(text);
  });
});

describe('tokenize', () => {
  it('folds accents, drops stamps, speakers and stopwords', () => {
    expect(tokenize(line(0, 'La Campaña y el PRESUPUESTO'))).toEqual(['campana', 'presupuesto']);
  });
});

describe('scoreWindows (BM25)', () => {
  it('gives the window with the query terms the top score', () => {
    const windows = splitTranscriptWindows(longTranscript());
    const scores = scoreWindows(windows, '¿Qué dijeron del presupuesto de la campana?');
    const best = scores.indexOf(Math.max(...scores));
    expect(windows[best]?.startMs).toBeGreaterThanOrEqual(9 * 60_000);
    expect(windows[best]?.startMs).toBeLessThan(11 * 60_000);
  });
});

describe('selectExcerpts', () => {
  it('returns the matching minute-10 window before the tail, within the budget', () => {
    const transcript = longTranscript();
    const out = selectExcerpts(transcript, '¿Y el presupuesto de la campaña?', 4000);
    expect(out.length).toBeLessThanOrEqual(4000);
    const hit = out.indexOf('presupuesto de la campaña');
    const tailStart = out.lastIndexOf('[37:');
    expect(hit).toBeGreaterThan(-1);
    expect(tailStart).toBeGreaterThan(hit);
    expect(out).toMatch(/^\[(09|10):\d\d–\d\d:\d\d\]\n/);
    expect(out.endsWith(transcript.slice(-50))).toBe(true);
  });

  it('always keeps the last ~1500 chars and lists windows in chronological order', () => {
    const transcript = longTranscript();
    const out = selectExcerpts(transcript, 'status update schedule pause', 6000);
    expect(out.length).toBeLessThanOrEqual(6000);
    const starts = [...out.matchAll(/^\[(\d\d):(\d\d)–/gm)].map(
      (m) => Number(m[1]) * 60 + Number(m[2]),
    );
    expect(starts.length).toBeGreaterThan(1);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    const tail = out.slice(out.lastIndexOf('\n\n') + 2);
    expect(tail.length).toBeGreaterThan(RETRIEVAL_TAIL_CHARS - 200);
  });

  it('returns only the tail when nothing matches', () => {
    const out = selectExcerpts(longTranscript(), 'zebra', 4000);
    expect(out.split('\n\n')).toHaveLength(1);
    expect(out.length).toBeLessThanOrEqual(RETRIEVAL_TAIL_CHARS + 20);
  });

  it('works on an unstamped transcript', () => {
    const lines = Array.from({ length: 400 }, (_, i) =>
      i === 50 ? 'hablamos de la migración de la base de datos' : `relleno sin datos ${String(i)}`,
    );
    const out = selectExcerpts(lines.join('\n'), 'migracion', 3000);
    expect(out.length).toBeLessThanOrEqual(3000);
    expect(out).toContain('migración de la base de datos');
    expect(out).toContain('relleno sin datos 399');
  });

  it('returns the whole transcript when it already fits', () => {
    expect(selectExcerpts('short text', 'anything', 1000)).toBe('short text');
  });
});
