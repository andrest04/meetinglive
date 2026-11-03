import { parseOffsetDate } from '@vozella/core';

/** Short date and short time in the user's locale, in local time (spec 2.7, the "g" format). */
export function formatMeetingDate(recordedAt: string, locale: string): string {
  const parsed = parseOffsetDate(recordedAt);
  if (!parsed) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(parsed.ms),
  );
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
