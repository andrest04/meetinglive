import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import { createTranslator, detectLocale, format } from './translate';

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\d+)(?::[^}]*)?\}/g)].map((match) => match[0]).sort();

describe('string catalogs', () => {
  it('have the same keys in English and Spanish', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it('keep the same placeholders for every key', () => {
    const mismatched = Object.keys(en).filter(
      (key) =>
        JSON.stringify(placeholders(en[key as keyof typeof en])) !==
        JSON.stringify(placeholders(es[key as keyof typeof es])),
    );
    expect(mismatched).toEqual([]);
  });

  it('carry no empty values', () => {
    const empty = [...Object.entries(en), ...Object.entries(es)].filter(([, v]) => v === '');
    expect(empty).toEqual([]);
  });

  it('are exactly what the converter produces from the WinUI resources', () => {
    const script = path.resolve(__dirname, '../../../../../scripts/convert-strings.mjs');
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});

describe('format', () => {
  it('fills positional placeholders and leaves missing ones visible', () => {
    expect(format('{0} of {1}', [3, 'five'])).toBe('3 of five');
    expect(format('{0} and {1}', ['a'])).toBe('a and {1}');
  });

  it('handles the .NET number patterns used in the source strings', () => {
    expect(format('{0:0.#} s', [1.26])).toBe('1.3 s');
    expect(format('{0:0}', [1.6])).toBe('2');
  });

  it('formats times with the locale', () => {
    const time = new Date(2026, 0, 2, 15, 4);
    expect(format('{0:t}', [time], 'en')).toMatch(/3:04/);
    expect(format('{0:t}', [time], 'es')).toMatch(/15:04/);
  });
});

describe('createTranslator', () => {
  it('translates by locale', () => {
    expect(createTranslator('en')('Nav_History.Content')).toBe('Library');
    expect(createTranslator('es')('Nav_Record.Content')).toBe(es['Nav_Record.Content']);
  });

  it('returns the key for an unknown key instead of throwing', () => {
    expect(createTranslator('en')('nope' as never)).toBe('nope');
  });
});

describe('detectLocale', () => {
  it('picks the first supported language and defaults to English', () => {
    expect(detectLocale(['es-PE', 'en-US'])).toBe('es');
    expect(detectLocale(['fr-FR', 'es'])).toBe('es');
    expect(detectLocale(['fr-FR'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});
