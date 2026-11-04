import { describe, expect, it } from 'vitest';
import { cutPrefix, cutTail } from './text-cut';

describe('text-cut', () => {
  it('keeps short text and plain cuts count UTF-16 units', () => {
    expect(cutPrefix('abcdef', 3)).toBe('abc');
    expect(cutTail('abcdef', 3)).toBe('def');
    expect(cutPrefix('abc', 3)).toBe('abc');
    expect(cutTail('abc', 5)).toBe('abc');
  });
  it('B10: never leaves half of an emoji at the cut', () => {
    expect(cutPrefix('ab😀cd', 3)).toBe('ab');
    expect(cutPrefix('ab😀cd', 4)).toBe('ab😀');
    expect(cutTail('ab😀cd', 3)).toBe('cd');
    expect(cutTail('ab😀cd', 4)).toBe('😀cd');
  });
  it('handles zero and negative limits', () => {
    expect(cutPrefix('abc', 0)).toBe('');
    expect(cutTail('abc', -1)).toBe('');
  });
});
