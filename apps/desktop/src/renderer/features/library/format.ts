import { parseOffsetDate } from '@vozella/core';

/** Short date and short time in the user's locale, in local time (spec 2.7, the "g" format). */
export function formatMeetingDate(recordedAt: string, locale: string): string {
  const parsed = parseOffsetDate(recordedAt);
  if (!parsed) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(parsed.ms),
  );
}

/** The time in the logbook gutter: local, on a 24 hour clock, so every row has the same width. */
export function formatMeetingTime(recordedAt: string, locale: string): string {
  const parsed = parseOffsetDate(recordedAt);
  if (!parsed) return '';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(parsed.ms));
}

const startOfDay = (ms: number): number => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** A plain sentence: Today, Yesterday, then "Tuesday 3 November", with the year only if it differs. */
export function formatDayHeader(
  ms: number,
  nowMs: number,
  locale: string,
  words: { readonly today: string; readonly yesterday: string },
): string {
  const today = startOfDay(nowMs);
  const day = startOfDay(ms);
  if (day === today) return words.today;
  // Through the date parts, because a daylight saving day is not 24 hours long.
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return words.yesterday;
  const sameYear = new Date(ms).getFullYear() === new Date(nowMs).getFullYear();
  const text = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
    .format(new Date(ms))
    .replace(',', '');
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

const SKIPPED_SHOWN = 3;
const REASON_MAX = 60;

/** File names with their reason, a few of them, so the person can find what was left out. */
export function describeSkipped(
  skipped: readonly { readonly path: string; readonly reason: string }[],
): string {
  const shown = skipped.slice(0, SKIPPED_SHOWN).map((file) => {
    const name = file.path.split(/[\\/]/).pop() ?? file.path;
    const reason =
      file.reason.length > REASON_MAX ? `${file.reason.slice(0, REASON_MAX)}...` : file.reason;
    return reason === '' ? name : `${name} (${reason})`;
  });
  const more = skipped.length - shown.length;
  return more > 0 ? `${shown.join(', ')}, +${String(more)}` : shown.join(', ');
}
