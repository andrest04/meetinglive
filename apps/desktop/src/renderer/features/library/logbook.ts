import { parseOffsetDate } from '@vozella/core';
import type { MeetingListItemDto } from '@vozella/contracts';

/** The list as the grid sees it: fixed heights, so scrolling never has to measure. */
export const HEADER_ROW_PX = 32;
export const MEETING_ROW_PX = 64;

const RULING_MAX_PX = 64;
const RULING_CAP_MINUTES = 120;
const PAGE_STEP = 8;

export type GridItem =
  | { readonly kind: 'header'; readonly key: string; readonly label: string }
  | { readonly kind: 'meeting'; readonly meeting: MeetingListItemDto };

/** Whole minutes between start and end; null when there is no real length to show. */
export function durationMinutes(recordedAt: string, endedAt: string | null): number | null {
  if (endedAt === null) return null;
  const start = parseOffsetDate(recordedAt);
  const end = parseOffsetDate(endedAt);
  if (!start || !end || end.ms <= start.ms) return null;
  return Math.round((end.ms - start.ms) / 60_000);
}

/** How far a row's ruling darkens. A square root, so short meetings still read as different. */
export function rulingWidthPx(minutes: number): number {
  const share = Math.min(Math.max(minutes, 0), RULING_CAP_MINUTES) / RULING_CAP_MINUTES;
  return Math.round(RULING_MAX_PX * Math.sqrt(share));
}

function localDayKey(ms: number | null): string {
  if (ms === null) return 'no-date';
  const date = new Date(ms);
  return `${String(date.getFullYear())}-${String(date.getMonth())}-${String(date.getDate())}`;
}

/** Puts a header before each run of meetings of one local day. The order given is kept. */
export function buildGridItems(
  meetings: readonly MeetingListItemDto[],
  dayLabel: (ms: number | null) => string,
): readonly GridItem[] {
  const items: GridItem[] = [];
  let lastDay: string | null = null;
  for (const meeting of meetings) {
    const ms = parseOffsetDate(meeting.recordedAt)?.ms ?? null;
    const day = localDayKey(ms);
    if (day !== lastDay) {
      items.push({
        kind: 'header',
        key: `day-${day}-${String(items.length)}`,
        label: dayLabel(ms),
      });
      lastDay = day;
    }
    items.push({ kind: 'meeting', meeting });
  }
  return items;
}

/** The header that sticks: the last one at or before the first row in view. */
export function activeHeaderIndex(items: readonly GridItem[], startIndex: number): number | null {
  for (let index = Math.min(startIndex, items.length - 1); index >= 0; index -= 1) {
    if (items[index]?.kind === 'header') return index;
  }
  return null;
}

/** The rendered rows: what is in view plus the rows that must stay in the DOM, in order. */
export function withPinned(range: readonly number[], pinned: readonly (number | null)[]): number[] {
  const all = new Set(range);
  for (const index of pinned) if (index !== null) all.add(index);
  return [...all].sort((a, b) => a - b);
}

const isMeeting = (items: readonly GridItem[], index: number): boolean =>
  items[index]?.kind === 'meeting';

function nearestMeeting(items: readonly GridItem[], from: number, step: 1 | -1): number | null {
  for (let index = from; index >= 0 && index < items.length; index += step) {
    if (isMeeting(items, index)) return index;
  }
  return null;
}

/** Where a key moves the cursor, skipping headers; null for a key the grid does not move on. */
export function movedIndex(items: readonly GridItem[], from: number, key: string): number | null {
  const last = items.length - 1;
  switch (key) {
    case 'ArrowDown':
      return nearestMeeting(items, from + 1, 1) ?? from;
    case 'ArrowUp':
      return nearestMeeting(items, from - 1, -1) ?? from;
    case 'Home':
      return nearestMeeting(items, 0, 1) ?? from;
    case 'End':
      return nearestMeeting(items, last, -1) ?? from;
    case 'PageDown': {
      const target = Math.min(from + PAGE_STEP, last);
      return nearestMeeting(items, target, 1) ?? nearestMeeting(items, target, -1) ?? from;
    }
    case 'PageUp': {
      const target = Math.max(from - PAGE_STEP, 0);
      return nearestMeeting(items, target, -1) ?? nearestMeeting(items, target, 1) ?? from;
    }
    default:
      return null;
  }
}
