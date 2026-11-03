import { describe, expect, it } from 'vitest';
import { formatOffsetDate, normalizeOffsetDate, parseOffsetDate } from './offset-date';

describe('offset dates', () => {
  it('round-trips the .NET round-trip format', () => {
    const text = '2026-09-01T12:00:00.0000000+00:00';
    const parsed = parseOffsetDate(text);
    expect(parsed).not.toBeNull();
    expect(formatOffsetDate(parsed!, 'round-trip')).toBe(text);
  });

  it('keeps seven fraction digits that JavaScript cannot represent', () => {
    expect(normalizeOffsetDate('2026-09-02T09:30:00.1234567-05:00')).toBe(
      '2026-09-02T09:30:00.1234567-05:00',
    );
  });

  it('accepts Z, short fractions, a space separator and compact offsets', () => {
    expect(normalizeOffsetDate('2026-09-01T12:00:00Z')).toBe('2026-09-01T12:00:00.0000000+00:00');
    expect(normalizeOffsetDate('2026-09-01 12:00:00.5+0530')).toBe(
      '2026-09-01T12:00:00.5000000+05:30',
    );
  });

  it('computes the instant from the offset', () => {
    const parsed = parseOffsetDate('2026-09-01T12:00:00-05:00')!;
    expect(new Date(parsed.ms).toISOString()).toBe('2026-09-01T17:00:00.000Z');
    expect(parsed.offsetMinutes).toBe(-300);
  });

  it('reads a value without an offset in the supplied local zone', () => {
    const parsed = parseOffsetDate('2026-09-01T12:00:00', () => 120)!;
    expect(parsed.offsetMinutes).toBe(120);
    expect(new Date(parsed.ms).toISOString()).toBe('2026-09-01T10:00:00.000Z');
  });

  it('formats the JSON style with trimmed fraction zeros', () => {
    const a = parseOffsetDate('2026-09-01T12:00:00.0000000-05:00')!;
    const b = parseOffsetDate('2026-09-02T09:30:00.1234567-05:00')!;
    const c = parseOffsetDate('2026-09-02T09:30:00.5000000+00:00')!;
    expect(formatOffsetDate(a, 'json')).toBe('2026-09-01T12:00:00-05:00');
    expect(formatOffsetDate(b, 'json')).toBe('2026-09-02T09:30:00.1234567-05:00');
    expect(formatOffsetDate(c, 'json')).toBe('2026-09-02T09:30:00.5+00:00');
  });

  it.each([
    '',
    'yesterday',
    '2026-13-01T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-09-01T25:00:00Z',
  ])('rejects %j', (text) => {
    expect(parseOffsetDate(text)).toBeNull();
  });
});
