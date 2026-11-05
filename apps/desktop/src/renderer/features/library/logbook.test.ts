import { describe, expect, it } from 'vitest';
import {
  activeHeaderIndex,
  buildGridItems,
  durationMinutes,
  movedIndex,
  rulingWidthPx,
  withPinned,
  type GridItem,
} from './logbook';
import { formatDayHeader, formatMeetingTime } from './format';

const meeting = (id: string, recordedAt: string) => ({ id, recordedAt }) as never;
const dayOf = (ms: number | null): string =>
  ms === null ? 'unknown' : new Date(ms).toISOString().slice(0, 10);

describe('durationMinutes', () => {
  it('rounds to whole minutes and honors the offsets', () => {
    expect(
      durationMinutes('2026-09-01T09:00:00.0000000+00:00', '2026-09-01T09:45:20.0000000+00:00'),
    ).toBe(45);
    expect(
      durationMinutes('2026-09-01T09:00:00.0000000-05:00', '2026-09-01T15:00:00.0000000+00:00'),
    ).toBe(60);
  });

  it('is null with no end, a bad date, or an end before the start', () => {
    expect(durationMinutes('2026-09-01T09:00:00.0000000+00:00', null)).toBeNull();
    expect(durationMinutes('nope', '2026-09-01T09:45:00.0000000+00:00')).toBeNull();
    expect(
      durationMinutes('2026-09-01T09:00:00.0000000+00:00', '2026-09-01T08:00:00.0000000+00:00'),
    ).toBeNull();
  });
});

describe('rulingWidthPx', () => {
  it('follows a square root, reaching 64 px at two hours and staying there', () => {
    expect(rulingWidthPx(0)).toBe(0);
    expect(rulingWidthPx(30)).toBe(32);
    expect(rulingWidthPx(120)).toBe(64);
    expect(rulingWidthPx(600)).toBe(64);
  });
});

describe('buildGridItems', () => {
  it('starts a header at each change of day, keeping the order it was given', () => {
    const items = buildGridItems(
      [
        meeting('c', '2026-09-03T10:00:00.0000000+00:00'),
        meeting('b', '2026-09-03T08:00:00.0000000+00:00'),
        meeting('a', '2026-09-01T08:00:00.0000000+00:00'),
      ],
      dayOf,
    );
    expect(items.map((i) => (i.kind === 'header' ? i.label : i.meeting.id))).toEqual([
      '2026-09-03',
      'c',
      'b',
      '2026-09-01',
      'a',
    ]);
  });

  it('files a meeting with a bad date under its own header', () => {
    const items = buildGridItems([meeting('x', 'nope')], dayOf);
    expect(items[0]).toMatchObject({ kind: 'header', label: 'unknown' });
  });

  it('has no headers and no rows with no meetings', () => {
    expect(buildGridItems([], dayOf)).toEqual([]);
  });
});

const h = (label: string): GridItem => ({ kind: 'header', key: label, label });
const m = (id: string): GridItem => ({ kind: 'meeting', meeting: { id } as never });

describe('activeHeaderIndex', () => {
  const items = [h('1'), m('a'), m('b'), h('2'), m('c')];
  it('is the last header at or before the first row in view', () => {
    expect(activeHeaderIndex(items, 0)).toBe(0);
    expect(activeHeaderIndex(items, 2)).toBe(0);
    expect(activeHeaderIndex(items, 3)).toBe(3);
    expect(activeHeaderIndex(items, 4)).toBe(3);
  });
  it('is null with nothing to show', () => {
    expect(activeHeaderIndex([], 0)).toBeNull();
  });
});

describe('withPinned', () => {
  it('adds the pinned rows in order, with no duplicates', () => {
    expect(withPinned([5, 6, 7], [0, 6, 40, null])).toEqual([0, 5, 6, 7, 40]);
  });
});

describe('movedIndex', () => {
  const items = [h('1'), m('a'), m('b'), h('2'), m('c')];
  it('skips headers and stops at the ends', () => {
    expect(movedIndex(items, 2, 'ArrowDown')).toBe(4);
    expect(movedIndex(items, 4, 'ArrowUp')).toBe(2);
    expect(movedIndex(items, 1, 'ArrowUp')).toBe(1);
    expect(movedIndex(items, 4, 'ArrowDown')).toBe(4);
  });
  it('jumps to the first and last meeting', () => {
    expect(movedIndex(items, 2, 'Home')).toBe(1);
    expect(movedIndex(items, 2, 'End')).toBe(4);
  });
  it('moves a page at a time onto a meeting', () => {
    const many = [h('1'), ...Array.from({ length: 20 }, (_, i) => m(String(i)))];
    expect(movedIndex(many, 1, 'PageDown')).toBe(9);
    expect(movedIndex(many, 9, 'PageUp')).toBe(1);
  });
  it('ignores other keys', () => {
    expect(movedIndex(items, 2, 'a')).toBeNull();
  });
});

describe('format', () => {
  const at = new Date(2026, 10, 3, 10, 30);
  const now = new Date(2026, 10, 4, 9, 0).getTime();
  const words = { today: 'Today', yesterday: 'Yesterday' };

  it('says Today and Yesterday, then the plain date', () => {
    expect(formatDayHeader(now, now, 'en', words)).toBe('Today');
    expect(formatDayHeader(at.getTime(), now, 'en', words)).toBe('Yesterday');
    const older = new Date(2026, 10, 2, 10, 30).getTime();
    expect(formatDayHeader(older, now, 'en', words)).toBe('Monday 2 November');
    expect(formatDayHeader(older, now, 'es', { today: 'Hoy', yesterday: 'Ayer' })).toBe(
      'Lunes 2 de noviembre',
    );
  });

  it('adds the year only when it differs', () => {
    const older = new Date(2025, 10, 2, 10, 30).getTime();
    expect(formatDayHeader(older, now, 'en', words)).toBe('Sunday 2 November 2025');
  });

  it('shows a 24 hour local time', () => {
    const offset = -at.getTimezoneOffset();
    const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
    const sign = offset >= 0 ? '+' : '-';
    const text = `2026-11-03T15:05:00.0000000${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
    expect(formatMeetingTime(text, 'en')).toBe('15:05');
    expect(formatMeetingTime('nope', 'en')).toBe('');
  });
});
