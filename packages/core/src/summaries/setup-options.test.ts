import { describe, expect, it } from 'vitest';
import { defaultModelFileName } from './setup-options';

type Row = Parameters<typeof defaultModelFileName>[0][number];
const row = (fileName: string, downloaded: boolean, fit: Row['fit']): Row => ({
  fileName,
  downloaded,
  fit,
});

describe('defaultModelFileName', () => {
  it('prefers the first downloaded model over a recommended one', () => {
    const rows = [
      row('a', false, 'Recommended'),
      row('b', true, 'MayBeSlow'),
      row('c', true, null),
    ];
    expect(defaultModelFileName(rows)).toBe('b');
  });

  it('falls back to the first Recommended model', () => {
    const rows = [
      row('a', false, 'MayBeSlow'),
      row('b', false, 'Recommended'),
      row('c', false, 'Recommended'),
    ];
    expect(defaultModelFileName(rows)).toBe('b');
  });

  it('falls back to the first row, and to null for none', () => {
    expect(defaultModelFileName([row('a', false, 'NotRecommended'), row('b', false, null)])).toBe(
      'a',
    );
    expect(defaultModelFileName([])).toBeNull();
  });
});
