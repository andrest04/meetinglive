import { parseOffsetDate } from '@vozella/core';

/** Short date and short time in the user's locale, in local time (spec 2.7, the "g" format). */
export function formatMeetingDate(recordedAt: string, locale: string): string {
  const parsed = parseOffsetDate(recordedAt);
  if (!parsed) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(parsed.ms),
  );
}
