import { describe, expect, it } from 'vitest';
import { threadTitleFromFirstMessage } from './thread-title';

describe('threadTitleFromFirstMessage', () => {
  it('FromFirstMessage_TrimsAndCapsAtSixtyCharacters', () => {
    expect(threadTitleFromFirstMessage('  hello  ')).toBe('hello');
    expect(threadTitleFromFirstMessage('a'.repeat(59) + ' ' + 'b'.repeat(20))).toBe('a'.repeat(59));
    expect(threadTitleFromFirstMessage('c'.repeat(60))).toHaveLength(60);
    expect(threadTitleFromFirstMessage('c'.repeat(70))).toHaveLength(60);
  });
  it('FromFirstMessage_CollapsesLineBreaks', () => {
    expect(threadTitleFromFirstMessage('First line\r\nsecond')).toBe('First line second');
    expect(threadTitleFromFirstMessage('A\nB\rC')).toBe('A B C');
  });
  it('B10: never cuts an emoji in half', () => {
    expect(threadTitleFromFirstMessage('a'.repeat(59) + '\u{1F600}zzz')).toBe('a'.repeat(59));
  });
});
