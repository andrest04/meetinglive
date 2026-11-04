import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import uiEn from './locales/ui.en.json';
import uiEs from './locales/ui.es.json';

// Items 107 and 136, bug 17. The shell string table of the spec (section 4.6) is the source of
// truth; this reads it, so a key added there fails here until both languages carry it.

const root = path.resolve(__dirname, '../../../../..');
const spec = fs.readFileSync(path.join(root, 'docs/port/specs/shell-platform.md'), 'utf8');
const catalogEn = { ...en, ...uiEn } as Record<string, string>;
const catalogEs = { ...es, ...uiEs } as Record<string, string>;

/** Strings of cut features (owner decision 2026-11-03, may return later); they stay inert. */
const CUT = new Set(['Nav_ResizePane', 'CalendarReminder_Body']);

interface Row {
  readonly key: string;
  readonly english: string;
  readonly spanish: string;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rows(): Row[] {
  const start = spec.indexOf('### 4.6 String tables');
  const end = spec.indexOf('### 4.7');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const found: Row[] = [];
  for (const line of spec.slice(start, end).split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const key = /^`([A-Za-z][A-Za-z0-9_.]*)`$/.exec(cells[1] ?? '')?.[1];
    if (key === undefined || key.endsWith('.*')) continue;
    found.push({ key, english: cells[2] ?? '', spanish: cells[3] ?? '' });
  }
  return found;
}

describe('shell strings (items 107 and 136)', () => {
  const table = rows().filter((row) => !CUT.has(row.key));

  it('reads a real table', () => {
    expect(table.length).toBeGreaterThan(30);
  });

  it.each(table.map((row) => [row.key, row] as const))(
    '%s exists in English and Spanish with the spec text',
    (key, row) => {
      // The migration text carries the failure after the spec sentence (bug 7, the {0} the WinUI
      // strings never had), so the spec text is the start of the value, not all of it.
      expect(catalogEn[key], `${key} (en)`).toMatch(new RegExp(`^${escape(row.english)}`));
      expect(catalogEs[key], `${key} (es)`).toMatch(new RegExp(`^${escape(row.spanish)}`));
    },
  );

  it('the default language of the table is English and no value is empty (bug 17)', () => {
    for (const row of table) {
      expect(catalogEn[row.key]?.trim(), row.key).toBeTruthy();
      expect(catalogEs[row.key]?.trim(), row.key).toBeTruthy();
    }
  });
});
