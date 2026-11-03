import { describe, expect, it } from 'vitest';
import { describeSkipped, formatMeetingDate } from './format';

describe('describeSkipped', () => {
  it('names the file and the reason, from either kind of path', () => {
    expect(
      describeSkipped([
        { path: 'C:\\Meetings\\2026\\standup.md', reason: 'Bad Jev block' },
        { path: '/lib/locked.md', reason: 'EBUSY' },
      ]),
    ).toBe('standup.md (Bad Jev block), locked.md (EBUSY)');
  });

  it('shows three files and counts the rest, and shortens a long reason', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ path: `${n}.md`, reason: '' }));
    expect(describeSkipped(many)).toBe('a.md, b.md, c.md, +2');
    expect(describeSkipped([{ path: 'x.md', reason: 'r'.repeat(80) }])).toBe(
      `x.md (${'r'.repeat(60)}...)`,
    );
  });
});

describe('formatMeetingDate', () => {
  it('shows a short date and a short time in the given locale, and nothing for bad text', () => {
    const at = '2026-09-01T09:30:00.0000000+00:00';
    const expected = new Intl.DateTimeFormat('en', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(at));
    expect(formatMeetingDate(at, 'en')).toBe(expected);
    expect(formatMeetingDate(at, 'en')).toMatch(/\d/);
    expect(formatMeetingDate(at, 'es')).not.toBe('');
    expect(formatMeetingDate('not a date', 'en')).toBe('');
  });
});
