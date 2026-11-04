import { describe, expect, it } from 'vitest';
import { importTimes } from './import-times';

describe('importTimes (B-19)', () => {
  it('treats the file time as the end and derives the start', () => {
    expect(importTimes(10_000_000, 60_000, 99)).toEqual({
      recordedAtMs: 9_940_000,
      endedAtMs: 10_000_000,
    });
  });
  it('uses now as the end when the file time is unreadable or zero', () => {
    expect(importTimes(null, 5_000, 100_000)).toEqual({ recordedAtMs: 95_000, endedAtMs: 100_000 });
    expect(importTimes(0, 5_000, 100_000).endedAtMs).toBe(100_000);
    expect(importTimes(Number.NaN, 5_000, 100_000).endedAtMs).toBe(100_000);
  });
  it('keeps start and end equal for an unknown duration', () => {
    expect(importTimes(7, Number.NaN, 1)).toEqual({ recordedAtMs: 7, endedAtMs: 7 });
  });
});
