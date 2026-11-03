import { describe, expect, it } from 'vitest';
import { hasTranscriptContent, parseLine, splitTranscript, toLines } from './transcript-lines';

describe('transcript lines', () => {
  it('treats null, empty and whitespace-only text as no content', () => {
    expect(hasTranscriptContent(null)).toBe(false);
    expect(hasTranscriptContent('')).toBe(false);
    expect(hasTranscriptContent(' \r\n\t ')).toBe(false);
    expect(hasTranscriptContent(' a ')).toBe(true);
  });

  it('splits on every newline style', () => {
    expect(splitTranscript('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps every character of a stamped, tagged, starred line', () => {
    const line = '* [00:04.52-00:09.10] [ Speaker-2 ] Empecemos';
    const parts = parseLine(line);
    expect(parts.map((p) => p.kind)).toEqual(['star', 'stamp', 'text']);
    expect(parts.map((p) => p.text).join('')).toBe(line);
  });

  it('does not mark header lines or odd brackets', () => {
    expect(parseLine('Recorded 2026-10-01 22:36').map((p) => p.kind)).toEqual(['text']);
    expect(parseLine('[1:2] x').map((p) => p.kind)).toEqual(['text']);
    expect(parseLine('*no space').map((p) => p.kind)).toEqual(['text']);
  });

  it('flags stars and blanks, and numbers lines', () => {
    const lines = toLines('* [00:00.00-00:01.00] a\n\nb');
    expect(lines.map((l) => [l.starred, l.blank, l.key])).toEqual([
      [true, false, 0],
      [false, true, 1],
      [false, false, 2],
    ]);
  });

  it('handles a 20000 line transcript', () => {
    const text = Array.from(
      { length: 20_000 },
      (_, i) => `[00:${String(i % 60).padStart(2, '0')}.00-00:59.00] line ${String(i)}`,
    ).join('\n');
    const lines = toLines(text);
    expect(lines).toHaveLength(20_000);
    expect(lines.map((l) => l.text).join('\n')).toBe(text);
  });
});
