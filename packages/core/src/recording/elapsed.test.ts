import { describe, expect, it } from 'vitest';
import { formatRecordingClock } from './elapsed';

describe('formatRecordingClock', () => {
  it('pads minutes and seconds', () => {
    expect(formatRecordingClock(0)).toBe('00:00');
    expect(formatRecordingClock(5)).toBe('00:05');
    expect(formatRecordingClock(65)).toBe('01:05');
  });
  it('lets minutes run past 59 (125:30)', () => {
    expect(formatRecordingClock(59 * 60 + 59)).toBe('59:59');
    expect(formatRecordingClock(3600)).toBe('60:00');
    expect(formatRecordingClock(125 * 60 + 30)).toBe('125:30');
  });
  it('floors fractions and clamps junk to zero', () => {
    expect(formatRecordingClock(59.9)).toBe('00:59');
    expect(formatRecordingClock(-3)).toBe('00:00');
    expect(formatRecordingClock(Number.NaN)).toBe('00:00');
  });
});
