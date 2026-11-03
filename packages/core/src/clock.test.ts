import { describe, expect, it } from 'vitest';
import { isExpired, type Clock } from './clock';

const clockAt = (iso: string): Clock => ({ now: () => new Date(iso) });

describe('isExpired', () => {
  const expiresAt = new Date('2026-01-01T00:00:00Z');

  it('is false before the instant', () => {
    expect(isExpired(clockAt('2025-12-31T23:59:59Z'), expiresAt)).toBe(false);
  });

  it('is true at and after the instant', () => {
    expect(isExpired(clockAt('2026-01-01T00:00:00Z'), expiresAt)).toBe(true);
    expect(isExpired(clockAt('2026-06-01T00:00:00Z'), expiresAt)).toBe(true);
  });
});
