import { describe, expect, it } from 'vitest';
import { DEFAULT_ANSWER_WINDOW_MS, takeRecentWindow } from './answer-window';

const stamp = (s: number): string => {
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}.00`;
};
const line = (start: number, end: number, text: string): string =>
  `[${stamp(start)}-${stamp(end)}] ${text}`;

describe('LiveAnswerWindow', () => {
  it('the default window is 90 seconds', () => {
    expect(DEFAULT_ANSWER_WINDOW_MS).toBe(90_000);
  });

  it('keeps lines at exactly 90 s before the latest end and drops older ones', () => {
    const text = [
      line(0, 20, 'a'),
      line(100, 109, 'b'),
      line(100, 110, 'c'),
      line(120, 130, 'd'),
      line(190, 200, 'e'),
    ].join('\n');
    expect(takeRecentWindow(text)).toBe(
      [line(100, 110, 'c'), line(120, 130, 'd'), line(190, 200, 'e')].join('\n'),
    );
  });

  it('keeps unstamped lines between kept ones, drops headers and lines outside the span', () => {
    const text = [
      'Recorded 2026-11-03 10:00',
      'orphan before',
      line(0, 10, 'old'),
      line(100, 150, 'first kept'),
      'middle unstamped',
      '  Ended-looking decoy',
      line(150, 200, 'last kept'),
      'orphan after',
      'Ended 2026-11-03 10:05',
    ].join('\n');
    expect(takeRecentWindow(text)).toBe(
      [
        line(100, 150, 'first kept'),
        'middle unstamped',
        '  Ended-looking decoy',
        line(150, 200, 'last kept'),
      ].join('\n'),
    );
  });

  it('without timestamps returns the last 2500 characters', () => {
    const text = 'x'.repeat(2400) + 'y'.repeat(300);
    expect(takeRecentWindow(text)).toBe(text.slice(-2500));
  });

  it('shorter than 2500 returns the whole text', () => {
    expect(takeRecentWindow('hello\nworld')).toBe('hello\nworld');
  });

  it('null is empty and garbage comes back unchanged', () => {
    expect(takeRecentWindow(null)).toBe('');
    expect(takeRecentWindow('[zz] [1:2-3:4] nope')).toBe('[zz] [1:2-3:4] nope');
  });

  it('keeps the CRLF newline of the input', () => {
    const text = [line(0, 10, 'a'), line(10, 20, 'b')].join('\r\n');
    expect(takeRecentWindow(text)).toBe(text);
  });

  it('a negative window keeps nothing', () => {
    expect(takeRecentWindow(line(0, 10, 'a'), -1)).toBe('');
  });
});
