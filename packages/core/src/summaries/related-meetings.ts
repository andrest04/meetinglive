import { parseOffsetDate } from '../library/offset-date';

export const MAX_RELATED_MEETINGS = 5;

export interface RelatedCandidate {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
  readonly seriesId: string | null;
}

export interface RelatedMeetingItem {
  readonly id: string;
  readonly title: string;
  readonly recordedAt: string;
}

export function instantOf(text: string): number {
  const parsed = parseOffsetDate(text);
  if (parsed !== null) return parsed.ms;
  const fallback = Date.parse(text);
  return Number.isNaN(fallback) ? 0 : fallback;
}

/**
 * Other meetings sharing the record's series id or its exact trimmed title (case-sensitive),
 * newest first, at most five. A blank series never matches a blank series, and
 * a blank title never matches a blank title (B11, a fix over RelatedMeetings.Find).
 */
export function findRelated(
  current: RelatedCandidate,
  all: readonly RelatedCandidate[],
): RelatedMeetingItem[] {
  const seriesId = (current.seriesId ?? '').trim();
  const title = current.title.trim();
  return all
    .filter((other) => {
      if (other.id === current.id) return false;
      const otherSeries = (other.seriesId ?? '').trim();
      if (seriesId !== '' && seriesId === otherSeries) return true;
      return title !== '' && title === other.title.trim();
    })
    .map((other, index) => ({ other, index, at: instantOf(other.recordedAt) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .slice(0, MAX_RELATED_MEETINGS)
    .map(({ other }) => ({ id: other.id, title: other.title, recordedAt: other.recordedAt }));
}
