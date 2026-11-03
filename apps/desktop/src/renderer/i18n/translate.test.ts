import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import uiEn from './locales/ui.en.json';
import uiEs from './locales/ui.es.json';
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

  it('keep the hand written Ui_ keys in step and apart from the converted ones', () => {
    expect(Object.keys(uiEs).sort()).toEqual(Object.keys(uiEn).sort());
    expect(Object.keys(uiEn).filter((key) => key in en)).toEqual([]);
    expect(Object.keys(uiEn).filter((key) => !key.startsWith('Ui_'))).toEqual([]);
    for (const key of Object.keys(uiEn)) {
      expect(placeholders(uiEn[key as keyof typeof uiEn])).toEqual(
        placeholders(uiEs[key as keyof typeof uiEs]),
      );
    }
  });

  it('carry no empty values', () => {
    const empty = [...Object.entries(en), ...Object.entries(es)].filter(([, v]) => v === '');
    expect(empty).toEqual([]);
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
