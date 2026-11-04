import { describe, expect, it } from 'vitest';
import { DEFAULT_ANSWER_WINDOW_MS, parseStampEnd, takeRecentWindow } from './answer-window';

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

  // Bug 17: the C# output newline followed the input. The port always answers with \n.
  it('accepts CRLF, LF and lone CR in one input and always joins with LF', () => {
    const text = `${line(0, 10, 'a')}\r\n${line(10, 20, 'b')}\n${line(20, 30, 'c')}\r${line(30, 40, 'd')}`;
    expect(takeRecentWindow(text)).toBe(
      [line(0, 10, 'a'), line(10, 20, 'b'), line(20, 30, 'c'), line(30, 40, 'd')].join('\n'),
    );
  });

  it('a pure CRLF input comes back with LF', () => {
    const text = [line(0, 10, 'a'), line(10, 20, 'b')].join('\r\n');
    expect(takeRecentWindow(text)).toBe([line(0, 10, 'a'), line(10, 20, 'b')].join('\n'));
  });

  it('the unstamped fallback also normalizes newlines', () => {
    expect(takeRecentWindow('one\r\ntwo\rthree')).toBe('one\ntwo\nthree');
  });

  // C# parity: the header test applies to every unstamped line, so these stay dropped.
  it('an unstamped line that starts with Recorded or Ended stays dropped, even inside the span', () => {
    const text = [
      line(100, 150, 'a'),
      'Recorded the decision to ship',
      '   Ended up agreeing',
      'Recorded',
      line(150, 200, 'b'),
    ].join('\n');
    // "Recorded" alone has no trailing space, so it is a normal unstamped line.
    expect(takeRecentWindow(text)).toBe(
      [line(100, 150, 'a'), 'Recorded', line(150, 200, 'b')].join('\n'),
    );
  });

  it('a stamped line whose body starts with Recorded is a normal line', () => {
    const text = [line(0, 10, 'Recorded in the cloud'), line(10, 20, 'Ended well')].join('\n');
    expect(takeRecentWindow(text)).toBe(text);
  });

  it.each([
    ['seconds 60', '[00:60.00-01:00.00] x'],
    ['one digit minutes', '[0:10.00-0:20.00] x'],
    ['three digit hundredths', '[00:10.000-00:20.000] x'],
    ['no dash', '[00:10.00] x'],
    ['bracket not first', ' [00:10.00-00:20.00] x'],
    ['a sign', '[+0:10.00-00:20.00] x'],
  ])('a stamp with %s is not a stamp', (_name, text) => {
    expect(parseStampEnd(text)).toBeNull();
  });

  it('minutes are unbounded', () => {
    expect(parseStampEnd('[100:00.00-123:04.50] x')).toBe((123 * 60 + 4) * 1000 + 500);
  });

  // Bug 16: the C# cut could leave half of a surrogate pair at the start.
  it('the 2500 character fallback never starts inside a surrogate pair', () => {
    const text = `${'x'.repeat(10)}😀${'y'.repeat(2499)}`;
    expect(takeRecentWindow(text)).toBe('y'.repeat(2499));
    const whole = `😀${'y'.repeat(2498)}`;
    expect(takeRecentWindow(`zz${whole}`)).toBe(whole);
  });

  it('a latest end of zero keeps the first line', () => {
    expect(takeRecentWindow(line(0, 0, 'a'))).toBe(line(0, 0, 'a'));
  });

  it('a negative window keeps nothing', () => {
    expect(takeRecentWindow(line(0, 10, 'a'), -1)).toBe('');
  });
});
