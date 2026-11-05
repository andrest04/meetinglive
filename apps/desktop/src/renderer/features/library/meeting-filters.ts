import { parseOffsetDate } from '@vozella/core';
import type { MeetingListItemDto } from '@vozella/contracts';

/** A custom range holds days as the date field gives them, `YYYY-MM-DD`; null leaves that end open. */
export type DateFilter =
  | { readonly kind: 'any' | 'last7' | 'last30' }
  | { readonly kind: 'range'; readonly from: string | null; readonly to: string | null };

export type StatusFilter = 'any' | 'withSummary' | 'withoutSummary' | 'withoutTranscript';

export interface MeetingFilters {
  readonly date: DateFilter;
  readonly status: StatusFilter;
}

export const ANY_DATE: DateFilter = { kind: 'any' };
export const NO_FILTERS: MeetingFilters = { date: ANY_DATE, status: 'any' };

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight of that local day. The explicit year setter also keeps years under 100 as they are. */
function localDay(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setFullYear(year, monthIndex, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** The local day of a `YYYY-MM-DD` text; null when it is not a day on the calendar. */
function parseDay(text: string | null): Date | null {
  const match = text === null ? null : DAY_PATTERN.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = localDay(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

const nextDay = (date: Date): Date =>
  localDay(date.getFullYear(), date.getMonth(), date.getDate() + 1);

/** The ends that are real days, earliest first: a range given backwards means the same days. */
export function normalizedRange(filter: Extract<DateFilter, { kind: 'range' }>): {
  readonly from: string | null;
  readonly to: string | null;
} {
  const fromDay = parseDay(filter.from);
  const toDay = parseDay(filter.to);
  const from = fromDay ? filter.from : null;
  const to = toDay ? filter.to : null;
  return fromDay && toDay && fromDay > toDay ? { from: to, to: from } : { from, to };
}

interface Window {
  readonly start: number;
  /** The first instant after the window. */
  readonly end: number;
}

/** The whole local days a date filter covers. Null when it asks for nothing. */
function dateWindow(filter: DateFilter, now: number): Window | null {
  if (filter.kind === 'any') return null;
  if (filter.kind === 'range') {
    const { from, to } = normalizedRange(filter);
    const start = parseDay(from);
    const last = parseDay(to);
    if (!start && !last) return null;
    return {
      start: start?.getTime() ?? -Infinity,
      end: last ? nextDay(last).getTime() : Infinity,
    };
  }
  const today = new Date(now);
  const days = filter.kind === 'last7' ? 7 : 30;
  return {
    start: localDay(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)).getTime(),
    end: nextDay(today).getTime(),
  };
}

type Filterable = Pick<MeetingListItemDto, 'recordedAt' | 'hasSummary' | 'hasTranscript'>;

function matchesStatus(meeting: Filterable, status: StatusFilter): boolean {
  switch (status) {
    case 'any':
      return true;
    case 'withSummary':
      return meeting.hasSummary;
    case 'withoutSummary':
      return !meeting.hasSummary;
    case 'withoutTranscript':
      return !meeting.hasTranscript;
  }
}

/**
 * The meetings the filters let through, in the order given. A meeting with no readable date has no
 * day to compare, so it goes as soon as a date is asked for.
 */
export function filterMeetings<T extends Filterable>(
  meetings: readonly T[],
  filters: MeetingFilters,
  now: number,
): readonly T[] {
  if (!isFiltering(filters)) return meetings;
  const window = dateWindow(filters.date, now);
  return meetings.filter((meeting) => {
    if (!matchesStatus(meeting, filters.status)) return false;
    if (!window) return true;
    const ms = parseOffsetDate(meeting.recordedAt)?.ms;
    return ms !== undefined && ms >= window.start && ms < window.end;
  });
}

const dateIsActive = (date: DateFilter): boolean => {
  if (date.kind !== 'range') return date.kind !== 'any';
  const { from, to } = normalizedRange(date);
  return from !== null || to !== null;
};

/** How many filters narrow the list. A custom range with no days yet narrows nothing. */
export const activeFilterCount = (filters: MeetingFilters): number =>
  (dateIsActive(filters.date) ? 1 : 0) + (filters.status === 'any' ? 0 : 1);

export const isFiltering = (filters: MeetingFilters): boolean => activeFilterCount(filters) > 0;

/** Equal for equal choices, so an effect can follow the filters by value. */
export const filterKey = (filters: MeetingFilters): string => JSON.stringify(filters);

/** A range's day for reading, as the day headers do: the year only if it differs. */
export function rangeDayLabel(day: string, locale: string, now: number): string {
  const date = parseDay(day);
  if (!date) return day;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);
}
