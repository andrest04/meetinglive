import { describe, expect, it } from 'vitest';
import { findRelated, MAX_RELATED_MEETINGS, type RelatedCandidate } from './related-meetings';

const c = (
  id: string,
  title: string,
  day: number,
  seriesId: string | null = null,
): RelatedCandidate => ({
  id,
  title,
  recordedAt: `2026-09-${String(day).padStart(2, '0')}T10:00:00.0000000+00:00`,
  seriesId,
});

describe('findRelated (item 103)', () => {
  const current = c('cur', 'Weekly sync', 20, 'series-1');

  it('matches the exact trimmed title, case-sensitive', () => {
    const all = [c('a', ' Weekly sync ', 1), c('b', 'weekly sync', 2), c('c', 'Other', 3)];
    expect(findRelated(current, all).map((r) => r.id)).toEqual(['a']);
  });

  it('matches a shared series id with a different title', () => {
    const all = [c('a', 'Different', 1, 'series-1'), c('b', 'Different', 2, 'series-2')];
    expect(findRelated(current, all).map((r) => r.id)).toEqual(['a']);
  });

  it('excludes the meeting itself', () => {
    expect(findRelated(current, [current])).toEqual([]);
  });

  it('a blank series never matches a blank series', () => {
    const cur = c('cur', 'X', 20, '  ');
    expect(findRelated(cur, [c('a', 'Y', 1, null), c('b', 'Z', 2, '')])).toEqual([]);
  });

  it('two empty titles match each other', () => {
    expect(findRelated(c('cur', '', 20), [c('a', '  ', 1)]).map((r) => r.id)).toEqual(['a']);
  });

  it('is newest first and capped at 5', () => {
    const all = Array.from({ length: 8 }, (_, i) => c(`m${i}`, 'Weekly sync', i + 1));
    const ids = findRelated(current, all).map((r) => r.id);
    expect(ids).toEqual(['m7', 'm6', 'm5', 'm4', 'm3']);
    expect(MAX_RELATED_MEETINGS).toBe(5);
  });

  it('orders by instant, not by text, across offsets', () => {
    const early = { ...c('e', 'Weekly sync', 5), recordedAt: '2026-09-05T23:00:00.0000000-05:00' };
    const late = { ...c('l', 'Weekly sync', 6), recordedAt: '2026-09-06T01:00:00.0000000+00:00' };
    expect(findRelated(current, [late, early]).map((r) => r.id)).toEqual(['e', 'l']);
  });
});
