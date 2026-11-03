import { describe, expect, it } from 'vitest';
import { fileStem, folderDirectoryName, sanitizeName } from './names';

describe('sanitizeName', () => {
  it.each([
    ['Q3: plan/review?', 'Q3 plan review'],
    ['Notes...', 'Notes'],
    ['inbox', 'Inbox folder'],
    ['INBOX', 'Inbox folder'],
    ['   ', 'Meeting'],
    ['', 'Meeting'],
    ['a   b', 'a b'],
    ['a<b>c|d"e', 'a b c d e'],
  ])('%j becomes %j', (input, expected) => {
    expect(sanitizeName(input)).toBe(expected);
  });

  it('treats null and undefined as an empty title', () => {
    expect(sanitizeName(null)).toBe('Meeting');
    expect(sanitizeName(undefined)).toBe('Meeting');
  });

  it('replaces control characters', () => {
    expect(sanitizeName('a\u0000b\tc')).toBe('a b c');
  });

  it('caps at 80 UTF-16 units', () => {
    expect(sanitizeName('x'.repeat(200))).toHaveLength(80);
  });

  it('B8a: a trailing space-dot sequence is trimmed completely', () => {
    expect(sanitizeName('abc .')).toBe('abc');
    expect(sanitizeName('abc . .')).toBe('abc');
  });

  it('B8b: truncation never cuts a surrogate pair in half', () => {
    const name = `${'a'.repeat(79)}\u{1F600}tail`;
    const result = sanitizeName(name);
    expect(result).toBe('a'.repeat(79));
  });

  it.each(['CON', 'nul', 'COM1', 'lpt9', 'AUX.txt', 'PRN'])(
    'B8c: the Windows device name %s gets a safe suffix',
    (name) => {
      const result = sanitizeName(name);
      expect(result).not.toBe(name);
      expect(/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(result)).toBe(false);
    },
  );

  it('does not touch names that merely contain a device name', () => {
    expect(sanitizeName('Console notes')).toBe('Console notes');
    expect(sanitizeName('COM10')).toBe('COM10');
  });
});

describe('folderDirectoryName', () => {
  it('B10: Meetings and Recordings are reserved like Inbox', () => {
    expect(folderDirectoryName('Meetings')).toBe('Meetings folder');
    expect(folderDirectoryName('recordings')).toBe('recordings folder');
    expect(folderDirectoryName('Inbox')).toBe('Inbox folder');
    expect(folderDirectoryName('Universidad')).toBe('Universidad');
  });
});

describe('fileStem', () => {
  it('uses the date in the stored offset, not local time', () => {
    expect(fileStem('2026-09-01T23:30:00.0000000-05:00', 'Standup')).toBe('2026-09-01 Standup');
  });

  it('sanitizes the title and falls back to Meeting', () => {
    expect(fileStem('2026-09-02T08:00:00.0000000-05:00', 'Q3: plan/review?')).toBe(
      '2026-09-02 Q3 plan review',
    );
    expect(fileStem('2026-09-02T08:00:00.0000000-05:00', '')).toBe('2026-09-02 Meeting');
  });
});
