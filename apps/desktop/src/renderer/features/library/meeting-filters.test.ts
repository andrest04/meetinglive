import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  activeFilterCount,
  filterKey,
  filterMeetings,
  isFiltering,
  normalizedRange,
  rangeDayLabel,
  type DateFilter,
  type MeetingFilters,
  type StatusFilter,
} from './meeting-filters';

const pad = (value: number): string => String(value).padStart(2, '0');

/** A stored date at this local wall-clock time, with the offset the machine has at that moment. */
function stamp(year: number, month: number, day: number, hour = 12, minute = 0, second = 0) {
  const date = new Date(year, month - 1, day, hour, minute, second);
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return (
    `${String(year)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}` +
    `.0000000${zone}`
  );
}

const meeting = (
  id: string,
  recordedAt: string,
  extra: { hasSummary?: boolean; hasTranscript?: boolean } = {},
) => ({ id, recordedAt, hasSummary: false, hasTranscript: false, ...extra });

const NOW = new Date(2026, 8, 15, 10, 30).getTime();

const ids = (
  list: readonly ReturnType<typeof meeting>[],
  filters: MeetingFilters,
): readonly string[] => filterMeetings(list, filters, NOW).map((m) => m.id);

const byDate = (date: DateFilter): MeetingFilters => ({ ...NO_FILTERS, date });
const byStatus = (status: StatusFilter): MeetingFilters => ({ ...NO_FILTERS, status });
const range = (from: string | null, to: string | null): MeetingFilters =>
  byDate({ kind: 'range', from, to });

describe('filterMeetings by date', () => {
  it('returns the same list, in the same order, with no filter', () => {
    const list = [meeting('b', stamp(2026, 9, 3)), meeting('a', stamp(2020, 1, 1))];
    expect(filterMeetings(list, NO_FILTERS, NOW)).toBe(list);
  });

  it('counts today as the first of the last 7 days, whole local days at both ends', () => {
    const list = [
      meeting('end of today', stamp(2026, 9, 15, 23, 59, 59)),
      meeting('tomorrow', stamp(2026, 9, 16, 0, 0, 0)),
      meeting('first day, first second', stamp(2026, 9, 9, 0, 0, 0)),
      meeting('the day before', stamp(2026, 9, 8, 23, 59, 59)),
    ];
    expect(ids(list, byDate({ kind: 'last7' }))).toEqual([
      'end of today',
      'first day, first second',
    ]);
  });

  it('counts back 30 local days, across a month', () => {
    const list = [
      meeting('first day', stamp(2026, 8, 17, 0, 0, 0)),
      meeting('the day before', stamp(2026, 8, 16, 23, 59, 59)),
    ];
    expect(ids(list, byDate({ kind: 'last30' }))).toEqual(['first day']);
  });

  it('reads the day of a meeting in local time, whatever offset the file was written with', () => {
    // The same local instant as 9 September at 00:30 here, stored in another zone's words.
    const instant = new Date(2026, 8, 9, 0, 30);
    const other = new Date(instant.getTime() + 5 * 3_600_000);
    const shifted =
      `${String(other.getUTCFullYear())}-${pad(other.getUTCMonth() + 1)}-${pad(other.getUTCDate())}` +
      `T${pad(other.getUTCHours())}:${pad(other.getUTCMinutes())}:00.0000000+05:00`;
    expect(ids([meeting('x', shifted)], byDate({ kind: 'last7' }))).toEqual(['x']);
  });

  it('includes both ends of a custom range', () => {
    const list = [
      meeting('after', stamp(2026, 9, 11, 0, 0, 0)),
      meeting('last second', stamp(2026, 9, 10, 23, 59, 59)),
      meeting('first second', stamp(2026, 9, 5, 0, 0, 0)),
      meeting('before', stamp(2026, 9, 4, 23, 59, 59)),
    ];
    expect(ids(list, range('2026-09-05', '2026-09-10'))).toEqual(['last second', 'first second']);
  });

  it('takes one day when from and to are the same', () => {
    const list = [meeting('in', stamp(2026, 9, 5, 18)), meeting('out', stamp(2026, 9, 6, 1))];
    expect(ids(list, range('2026-09-05', '2026-09-05'))).toEqual(['in']);
  });

  it('leaves an end of the range open when it is empty', () => {
    const list = [meeting('new', stamp(2026, 9, 12)), meeting('old', stamp(2026, 1, 2))];
    expect(ids(list, range('2026-09-01', null))).toEqual(['new']);
    expect(ids(list, range(null, '2026-09-01'))).toEqual(['old']);
  });

  it('reads a range given backwards as the same days', () => {
    const list = [meeting('in', stamp(2026, 9, 7)), meeting('out', stamp(2026, 9, 11))];
    expect(ids(list, range('2026-09-10', '2026-09-05'))).toEqual(['in']);
    expect(normalizedRange({ kind: 'range', from: '2026-09-10', to: '2026-09-05' })).toEqual({
      from: '2026-09-05',
      to: '2026-09-10',
    });
  });

  it('ignores an end that is not a real day', () => {
    const list = [meeting('x', stamp(2026, 9, 12))];
    expect(ids(list, range('2026-02-31', null))).toEqual(['x']);
    expect(ids(list, range('soon', 'later'))).toEqual(['x']);
  });

  it('leaves out a meeting with no readable date once a date is asked for', () => {
    const list = [meeting('no date', 'not a date')];
    expect(ids(list, byDate({ kind: 'last30' }))).toEqual([]);
    expect(ids(list, range('2026-09-01', null))).toEqual([]);
    expect(ids(list, NO_FILTERS)).toEqual(['no date']);
  });
});

describe('filterMeetings by status', () => {
  const list = [
    meeting('both', stamp(2026, 9, 1), { hasSummary: true, hasTranscript: true }),
    meeting('summary only', stamp(2026, 9, 1), { hasSummary: true }),
    meeting('transcript only', stamp(2026, 9, 1), { hasTranscript: true }),
    meeting('neither', stamp(2026, 9, 1)),
  ];

  it('follows the flags on the list item', () => {
    expect(ids(list, byStatus('withSummary'))).toEqual(['both', 'summary only']);
    expect(ids(list, byStatus('withoutSummary'))).toEqual(['transcript only', 'neither']);
    expect(ids(list, byStatus('withoutTranscript'))).toEqual(['summary only', 'neither']);
  });

  it('combines with a date', () => {
    const dated = [
      meeting('recent', stamp(2026, 9, 14), { hasSummary: true }),
      meeting('recent, no summary', stamp(2026, 9, 14)),
      meeting('old', stamp(2026, 1, 14), { hasSummary: true }),
    ];
    expect(ids(dated, { date: { kind: 'last7' }, status: 'withSummary' })).toEqual(['recent']);
  });
});

describe('what counts as a filter', () => {
  it('does not count the defaults or a custom range with no days yet', () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering(range(null, null))).toBe(false);
    expect(activeFilterCount(range(null, null))).toBe(0);
    expect(activeFilterCount(range('nonsense', null))).toBe(0);
  });

  it('counts the date and the status once each', () => {
    expect(activeFilterCount(byDate({ kind: 'last7' }))).toBe(1);
    expect(activeFilterCount(byStatus('withSummary'))).toBe(1);
    expect(activeFilterCount(range(null, '2026-09-01'))).toBe(1);
    expect(activeFilterCount({ date: { kind: 'last30' }, status: 'withoutTranscript' })).toBe(2);
  });

  it('gives each choice its own key', () => {
    expect(filterKey(byDate({ kind: 'last7' }))).not.toBe(filterKey(byDate({ kind: 'last30' })));
    expect(filterKey(range('2026-09-01', null))).not.toBe(filterKey(range(null, '2026-09-01')));
    expect(filterKey(NO_FILTERS)).toBe(filterKey({ ...NO_FILTERS }));
  });
});

describe('rangeDayLabel', () => {
  it('reads like the day headers: day first in English, the year only if it differs', () => {
    expect(rangeDayLabel('2026-09-05', 'en', NOW)).toBe('5 Sept');
    expect(rangeDayLabel('2025-09-05', 'en', NOW)).toBe('5 Sept 2025');
    expect(rangeDayLabel('2026-09-05', 'es', NOW)).toMatch(/^5 sept?$/);
  });
});
