import { describe, expect, it } from 'vitest';
import { formatCustomDate, formatTemplate } from './format';
import { createLookup, meetingTitle } from './translator';

const when = new Date(2026, 10, 3, 15, 4, 9); // Tuesday 3 November 2026

describe('formatTemplate', () => {
  it('fills positional placeholders and leaves missing ones visible', () => {
    expect(formatTemplate('{0} of {1}', [3, 'five'])).toBe('3 of five');
    expect(formatTemplate('{0} and {1}', ['a'])).toBe('a and {1}');
  });

  it('size uses 0.# in the locale', () => {
    const model = '{0} · Quality {1} · {2:0.#} GB download';
    expect(formatTemplate(model, ['Fast', 'Good', 0.81], 'en')).toBe(
      'Fast · Quality Good · 0.8 GB download',
    );
    expect(formatTemplate('{2:0.#}', ['', '', 3.11], 'en')).toBe('3.1');
    expect(formatTemplate('{2:0.#}', ['', '', 4.98], 'en')).toBe('5');
    expect(formatTemplate('{2:0.#}', ['', '', 7.12], 'en')).toBe('7.1');
    expect(formatTemplate('{2:0.#}', ['', '', 7.12], 'es')).toBe('7,1');
  });

  it('{1:0} rounds to a whole number', () => {
    expect(formatTemplate('{0} {1:0}%', ['m', 40.4], 'en')).toBe('m 40%');
    expect(formatTemplate('{1:0}', ['m', 99.6], 'es')).toBe('100');
  });

  it('{n:t} is the short time of the locale', () => {
    expect(formatTemplate('{0:t}', [when], 'en')).toMatch(/^3:04\s?PM$/);
    expect(formatTemplate('{0:t}', [when], 'es')).toBe('15:04');
  });

  it('{n:ddd, MMM d} uses the abbreviations of the locale', () => {
    expect(formatTemplate('{0:ddd, MMM d}', [when], 'en')).toBe('Tue, Nov 3');
    expect(formatTemplate('{0:ddd, MMM d}', [when], 'es')).toMatch(/^mar\.?,? nov\.? 3$/);
  });
});

describe('formatCustomDate', () => {
  it('renders the patterns of MeetingTitleDateFormat', () => {
    expect(formatCustomDate(when, 'd MMM, HH:mm', 'en')).toBe('3 Nov, 15:04');
    expect(formatCustomDate(when, 'd MMM, HH:mm', 'es')).toMatch(/^3 nov\.?, 15:04$/);
  });

  it('pads, 12 hour clock and literals', () => {
    const early = new Date(2026, 0, 5, 0, 7, 3);
    expect(formatCustomDate(early, 'dd/MM/yyyy hh:mm:ss tt', 'en')).toBe('05/01/2026 12:07:03 AM');
    expect(formatCustomDate(early, "yy 'at' H:m", 'en')).toBe('26 at 0:7');
    expect(formatCustomDate(early, 'dddd MMMM', 'en')).toBe('Monday January');
  });
});

const catalogs = {
  en: {
    Hello: 'Hello {0}',
    OnlyEn: 'Only English',
    MeetingTitleFormat: 'Meeting {0}',
    MeetingTitleDateFormat: 'd MMM, HH:mm',
  },
  es: {
    Hello: 'Hola {0}',
    MeetingTitleFormat: 'Reunión {0}',
    MeetingTitleDateFormat: 'd MMM, HH:mm',
  },
};

describe('createLookup', () => {
  it('honors the requested locale', () => {
    expect(createLookup(catalogs, 'en')('Hello', 'Ana')).toBe('Hello Ana');
    expect(createLookup(catalogs, 'es')('Hello', 'Ana')).toBe('Hola Ana');
  });

  it('B8: a missing key falls back to English, then to the key, and reports each miss', () => {
    const misses: string[] = [];
    const t = createLookup(catalogs, 'es', (key, locale, fallback) => {
      misses.push(`${key}:${locale}:${fallback}`);
    });
    expect(t('OnlyEn')).toBe('Only English');
    expect(t('Nope')).toBe('Nope');
    expect(misses).toEqual(['OnlyEn:es:en', 'Nope:es:key']);
  });

  it('never returns an empty string for an unknown key', () => {
    expect(createLookup(catalogs, 'en')('Unknown_Key')).toBe('Unknown_Key');
  });
});

describe('meetingTitle', () => {
  it('composes the date into the title format of each locale', () => {
    expect(meetingTitle(createLookup(catalogs, 'en'), when, 'en')).toBe('Meeting 3 Nov, 15:04');
    expect(meetingTitle(createLookup(catalogs, 'es'), when, 'es')).toMatch(
      /^Reunión 3 nov\.?, 15:04$/,
    );
  });
});
