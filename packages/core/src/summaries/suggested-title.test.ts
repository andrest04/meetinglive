import { describe, expect, it } from 'vitest';
import {
  looksLikePlaceholder,
  normalizeTitle,
  placeholderPatternsFromFormats,
  resolveTitle,
  titleFromModelResponse,
} from './suggested-title';

describe('normalizeTitle', () => {
  it('returns null for null and blank', () => {
    expect(normalizeTitle(null)).toBeNull();
    expect(normalizeTitle('  \n ')).toBeNull();
  });
  it('takes the first non-empty line', () => {
    expect(normalizeTitle('\n\n  Plan  \nsecond')).toBe('Plan');
  });
  it('strips leading hashes', () => {
    expect(normalizeTitle('## Plan')).toBe('Plan');
  });
  it('strips wrapping straight and curly quotes only', () => {
    expect(normalizeTitle('"Plan"')).toBe('Plan');
    expect(normalizeTitle('“Plan”')).toBe('Plan');
    expect(normalizeTitle("'Plan'")).toBe("'Plan'");
    expect(normalizeTitle('«Plan»')).toBe('«Plan»');
  });
  it('strips trailing periods, also after quotes', () => {
    expect(normalizeTitle('Plan...')).toBe('Plan');
    expect(normalizeTitle('"Plan."')).toBe('Plan');
  });
  it('caps at 80 and trims', () => {
    expect(normalizeTitle('a'.repeat(100))).toBe('a'.repeat(80));
    expect(normalizeTitle('a'.repeat(79) + ' bbb')).toBe('a'.repeat(79));
  });
  it('gives null when empty after cleaning', () => {
    expect(normalizeTitle('##')).toBeNull();
    expect(normalizeTitle('""')).toBeNull();
    expect(normalizeTitle('...')).toBeNull();
  });
});

describe('titleFromModelResponse', () => {
  it('normalizes a plain reply', () => {
    expect(titleFromModelResponse('Weekly sync')).toBe('Weekly sync');
  });
  it('handles a reply wrapped in a heading', () => {
    expect(titleFromModelResponse('# Weekly sync')).toBe('Weekly sync');
  });
  it('reads the title block before the summary', () => {
    expect(titleFromModelResponse('## Title\nWeekly sync\n\n## Summary\nBody')).toBe('Weekly sync');
  });
  it('strips quotes', () => {
    expect(titleFromModelResponse('"Weekly sync"')).toBe('Weekly sync');
    expect(titleFromModelResponse('## Title\n"Weekly sync"')).toBe('Weekly sync');
  });
  it('gives null for empty and heading-only replies', () => {
    expect(titleFromModelResponse('')).toBeNull();
    expect(titleFromModelResponse(null)).toBeNull();
    expect(titleFromModelResponse('## Title')).toBeNull();
    expect(titleFromModelResponse('## Title\n\n## Summary\nBody')).toBeNull();
  });
});

describe('looksLikePlaceholder', () => {
  it('treats blank as a placeholder', () => {
    expect(looksLikePlaceholder('')).toBe(true);
    expect(looksLikePlaceholder('  ')).toBe(true);
    expect(looksLikePlaceholder(null)).toBe(true);
  });
  it('recognizes English auto titles and rejects user names', () => {
    expect(looksLikePlaceholder('Meeting 3 nov, 15:04')).toBe(true);
    expect(looksLikePlaceholder('  meeting 3')).toBe(true);
    expect(looksLikePlaceholder('Meeting notes')).toBe(false);
    expect(looksLikePlaceholder('Budget')).toBe(false);
  });
  it('B10: recognizes the Spanish auto title once its format is supplied', () => {
    const patterns = placeholderPatternsFromFormats(['Meeting {0}', 'Reunión {0}']);
    expect(looksLikePlaceholder('Reunión 3 nov, 15:04', patterns)).toBe(true);
    expect(looksLikePlaceholder('reunión 3 nov', patterns)).toBe(true);
    expect(looksLikePlaceholder('Reunión semanal', patterns)).toBe(false);
    expect(looksLikePlaceholder('Meeting 3', patterns)).toBe(true);
  });
  it('escapes regex characters in formats and ignores formats without a prefix', () => {
    const patterns = placeholderPatternsFromFormats(['{0}', 'A.B {0}']);
    expect(patterns).toHaveLength(1);
    expect(looksLikePlaceholder('A.B 1', patterns)).toBe(true);
    expect(looksLikePlaceholder('AxB 1', patterns)).toBe(false);
  });
});

describe('resolveTitle', () => {
  it('keeps current when the suggestion is null or normalizes to null', () => {
    expect(resolveTitle('Meeting 3', null)).toBe('Meeting 3');
    expect(resolveTitle('Meeting 3', '""')).toBe('Meeting 3');
  });
  it('replaces a placeholder current title', () => {
    expect(resolveTitle('Meeting 3', '"Budget."')).toBe('Budget');
  });
  it('replaces an empty current title', () => {
    expect(resolveTitle('', 'Budget')).toBe('Budget');
  });
  it('keeps a user-named title', () => {
    expect(resolveTitle('My talk', 'Budget')).toBe('My talk');
  });
  it('B10: renames a Spanish auto title on summarize', () => {
    const patterns = placeholderPatternsFromFormats(['Meeting {0}', 'Reunión {0}']);
    expect(resolveTitle('Reunión 3 nov, 15:04', 'Presupuesto', patterns)).toBe('Presupuesto');
  });
});
