import { describe, expect, it } from 'vitest';
import { describeSkipped, formatMeetingDate, formatMeetingSpan } from './format';

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

describe('formatMeetingSpan', () => {
  const now = new Date('2026-11-04T12:00:00').getTime();
  const local = (time: string): string => {
    const date = new Date(`2026-11-03T${time}:00`);
    const offset = -date.getTimezoneOffset();
    const sign = offset < 0 ? '-' : '+';
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
    return `2026-11-03T${time}:00.0000000${sign}${hours}:${minutes}`;
  };

  it('has the day and the two times', () => {
    expect(formatMeetingSpan(local('10:30'), local('11:15'), now, 'en')).toEqual({
      day: 'Tuesday 3 November',
      start: '10:30',
      end: '11:15',
    });
  });

  it('has no end without one, and names the year of another year', () => {
    expect(formatMeetingSpan(local('10:30'), null, now, 'en')?.end).toBeNull();
    const later = new Date('2027-02-01T12:00:00').getTime();
    expect(formatMeetingSpan(local('10:30'), null, later, 'en')?.day).toBe(
      'Tuesday 3 November 2026',
    );
  });

  it('is capitalized in Spanish and null for bad text', () => {
    expect(formatMeetingSpan(local('10:30'), null, now, 'es')?.day).toMatch(/^Martes/);
    expect(formatMeetingSpan('not a date', null, now, 'en')).toBeNull();
  });
});
