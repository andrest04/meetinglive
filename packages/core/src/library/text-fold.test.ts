import { describe, expect, it } from 'vitest';
import { foldText, foldedWords, hasAllWords } from './text-fold';

describe('foldText', () => {
  it('drops case and accents', () => {
    expect(foldText('Reunión de AÑO en Cálculo')).toBe('reunion de ano en calculo');
  });

  it('keeps the length of the original, so an offset in one is an offset in the other', () => {
    for (const text of ['Última revisión', 'İstanbul ß', 'ﬁnal', 'a😀é', 'café']) {
      expect(foldText(text)).toHaveLength(text.length);
    }
    const original = 'Última revisión del año';
    const start = foldText(original).indexOf('revision');
    expect(original.slice(start, start + 8)).toBe('revisión');
  });

  it('leaves characters with no plain form as they are', () => {
    expect(foldText('日本語 😀')).toBe('日本語 😀');
  });
});

describe('foldedWords', () => {
  it('splits on any white space and folds each word', () => {
    expect(foldedWords('  Año\t CÁLCULO\n')).toEqual(['ano', 'calculo']);
    expect(foldedWords('   ')).toEqual([]);
  });

  it('composes a decomposed query, so it matches composed text', () => {
    expect(foldedWords('café')).toEqual(['cafe']);
  });
});

describe('hasAllWords', () => {
  it('needs every word, in any order', () => {
    expect(hasAllWords('weekly sync planning', ['sync', 'weekly'])).toBe(true);
    expect(hasAllWords('weekly sync planning', ['sync', 'review'])).toBe(false);
    expect(hasAllWords('anything', [])).toBe(true);
  });
});
