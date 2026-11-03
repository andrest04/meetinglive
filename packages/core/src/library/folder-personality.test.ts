import { describe, expect, it } from 'vitest';
import {
  ACCENT_KEYS,
  ICON_KEYS,
  nextAccentKey,
  resolveAccentKey,
  resolveIconKey,
} from './folder-personality';

describe('accent colors', () => {
  it('has the seven keys in order', () => {
    expect(ACCENT_KEYS).toEqual(['blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple']);
  });

  it('returns the canonical key for a known stored key, ignoring case', () => {
    expect(resolveAccentKey('TEAL', 'x')).toBe('teal');
  });

  it('B1: an unset color is deterministic across calls and processes', () => {
    const id = '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b';
    expect(resolveAccentKey(null, id)).toBe(resolveAccentKey(undefined, id));
    // Pinned values: a change here would recolor every folder that has no stored color.
    expect(resolveAccentKey('', '00000000-0000-0000-0000-000000000000')).toBe(
      resolveAccentKey('nope', '00000000-0000-0000-0000-000000000000'),
    );
    expect(PINNED.map(([id]) => resolveAccentKey(null, id))).toEqual(PINNED.map(([, key]) => key));
  });

  it('B1: spreads ids over all keys and never throws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(resolveAccentKey(null, `id-${i}`));
    expect(seen.size).toBe(7);
  });

  it('nextAccentKey skips the used colors', () => {
    expect(nextAccentKey([])).toBe('blue');
    expect(nextAccentKey(['blue', null, 'TEAL'])).toBe('green');
  });

  it('nextAccentKey wraps by the used count when all are taken', () => {
    expect(nextAccentKey([...ACCENT_KEYS])).toBe('blue');
    expect(nextAccentKey([...ACCENT_KEYS, 'custom'])).toBe('teal');
  });
});

const PINNED: readonly (readonly [string, string])[] = [
  ['00000000-0000-0000-0000-000000000000', 'amber'],
  ['7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b', 'orange'],
];

describe('icons', () => {
  it('has the 18 keys in order', () => {
    expect(ICON_KEYS).toHaveLength(18);
    expect(ICON_KEYS[0]).toBe('folder');
    expect(ICON_KEYS[17]).toBe('toolbox');
  });

  it('resolves case-insensitively and falls back to folder', () => {
    expect(resolveIconKey('Briefcase')).toBe('briefcase');
    expect(resolveIconKey(null)).toBe('folder');
    expect(resolveIconKey('unknown')).toBe('folder');
  });
});
