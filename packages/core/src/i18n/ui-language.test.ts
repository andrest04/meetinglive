import { describe, expect, it } from 'vitest';
import {
  catalogLocaleFor,
  localeOfUiTag,
  matchPrimarySubtag,
  resolveCulture,
  resolveUiLanguage,
  UI_LANGUAGE_OPTIONS,
} from './ui-language';

describe('resolveCulture', () => {
  it('English gives en-US and Spanish gives es', () => {
    expect(resolveCulture('en-US')).toBe('en-US');
    expect(resolveCulture('es')).toBe('es');
  });

  it('is null for null, empty and whitespace', () => {
    for (const blank of [null, '', '   ']) expect(resolveCulture(blank)).toBeNull();
  });

  it('is null for an unrecognized tag', () => {
    expect(resolveCulture('xx-99-INVALID!')).toBeNull();
  });

  it('B20: a well formed tag for no real language is null on every platform', () => {
    expect(resolveCulture('xx')).toBeNull();
    expect(resolveCulture('qqq-US')).toBeNull();
  });

  it('B20: an underscore tag is read like the hyphen form', () => {
    expect(resolveCulture('es_ES')).toBe('es-ES');
    expect(resolveCulture('ES-es')).toBe('es-ES');
  });
});

describe('matchPrimarySubtag', () => {
  const available = ['en-US', 'es'];

  it('matches the available primary only when the candidate has a region', () => {
    expect(matchPrimarySubtag('es-ES', available)).toBe('es');
  });

  it('matches the candidate primary only when the available tag has a region', () => {
    expect(matchPrimarySubtag('en-GB', available)).toBe('en-US');
  });

  it('is case insensitive and returns the available tag as written', () => {
    expect(matchPrimarySubtag('ES-es', available)).toBe('es');
  });

  it('is null for a null or blank candidate', () => {
    for (const blank of [null, '', '   ']) expect(matchPrimarySubtag(blank, available)).toBeNull();
  });

  it('is null when nothing matches', () => {
    expect(matchPrimarySubtag('fr-FR', available)).toBeNull();
  });

  it('B20: an underscore candidate matches by primary subtag', () => {
    expect(matchPrimarySubtag('es_ES', available)).toBe('es');
  });

  it('the first match wins', () => {
    expect(matchPrimarySubtag('en', ['en-GB', 'en-US'])).toBe('en-GB');
  });
});

describe('resolveUiLanguage', () => {
  it('the saved choice wins over the OS', () => {
    expect(resolveUiLanguage('es', ['en-US'])).toBe('es');
    expect(resolveUiLanguage('en-US', ['es-ES'])).toBe('en-US');
  });

  it('older or hand edited saved values match by primary subtag', () => {
    expect(resolveUiLanguage('es-ES', [])).toBe('es');
    expect(resolveUiLanguage('EN', [])).toBe('en-US');
  });

  it('with nothing saved it follows the first OS language we ship', () => {
    expect(resolveUiLanguage(null, ['fr-FR', 'es-MX', 'en-US'])).toBe('es');
    expect(resolveUiLanguage('  ', ['en-GB'])).toBe('en-US');
  });

  it('falls back to English when nothing matches', () => {
    expect(resolveUiLanguage(null, ['fr-FR'])).toBe('en-US');
    expect(resolveUiLanguage('fr', ['es'])).toBe('en-US');
    expect(resolveUiLanguage(null, [])).toBe('en-US');
  });
});

describe('locale of a tag', () => {
  it('maps the picker tags to catalog locales', () => {
    expect(localeOfUiTag('en-US')).toBe('en');
    expect(localeOfUiTag('es')).toBe('es');
  });

  it('is null when there are no strings for the language', () => {
    expect(catalogLocaleFor('es_MX')).toBe('es');
    expect(catalogLocaleFor('fr')).toBeNull();
    expect(catalogLocaleFor(null)).toBeNull();
  });
});

describe('UI_LANGUAGE_OPTIONS (item 13)', () => {
  it('has exactly en-US then es, with the same label key in both locales', () => {
    expect(UI_LANGUAGE_OPTIONS.map((o) => [o.tag, o.locale, o.labelKey])).toEqual([
      ['en-US', 'en', 'Settings_LanguageEnglish'],
      ['es', 'es', 'Settings_LanguageSpanish'],
    ]);
  });
});
