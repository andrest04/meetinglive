import fs from 'node:fs';
import path from 'node:path';
import {
  CLI_STATUS_KEYS,
  FIT_LABEL_KEYS,
  SETTINGS_MESSAGE_KEYS,
  SETTINGS_SECTIONS,
  NOTE_TEMPLATE_BUILT_INS,
  SUMMARY_LANGUAGES,
  SUMMARY_MODELS,
  TRANSCRIPTION_LANGUAGES,
  UI_LANGUAGE_OPTIONS,
  createLookup,
  formatTemplate,
  meetingTitle,
} from '@vozella/core';
import { describe, expect, it } from 'vitest';
import en from '../renderer/i18n/locales/en.json';
import es from '../renderer/i18n/locales/es.json';
import uiEn from '../renderer/i18n/locales/ui.en.json';
import uiEs from '../renderer/i18n/locales/ui.es.json';

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string): string => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function dataEntries(xml: string): [string, string][] {
  const out: [string, string][] = [];
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of withoutComments.matchAll(/<data\s+([^>]*?)>\s*<value>([\s\S]*?)<\/value>/g)) {
    const attributes = m[1] ?? '';
    // Typed entries (images, binary) are not strings.
    if (/\b(type|mimetype)=/.test(attributes)) continue;
    const name = /\bname="([^"]+)"/.exec(attributes)?.[1];
    if (name !== undefined) out.push([name, m[2] ?? '']);
  }
  return out;
}

const resw = {
  en: dataEntries(read('MeetingLive.App/Strings/en-us/Resources.resw')),
  es: dataEntries(read('MeetingLive.App/Strings/es/Resources.resw')),
};
const core = {
  en: dataEntries(read('MeetingLive.Core/Strings/CoreStrings.resx')),
  es: dataEntries(read('MeetingLive.Core/Strings/CoreStrings.es.resx')),
};
const catalogs = { en: { ...en, ...uiEn }, es: { ...es, ...uiEs } } as Record<
  'en' | 'es',
  Record<string, string>
>;
const placeholderIndexes = (text: string): string[] =>
  [...text.matchAll(/\{(\d+)/g)].map((m) => m[1] ?? '').sort();

describe('app strings (item 105 to 112)', () => {
  it('have 604 keys in each locale, in the same order, none empty', () => {
    expect(resw.en).toHaveLength(604);
    expect(resw.es).toHaveLength(604);
    expect(resw.en.map(([k]) => k)).toEqual(resw.es.map(([k]) => k));
    expect([...resw.en, ...resw.es].filter(([, v]) => v === '')).toEqual([]);
  });

  it('every key is in the JSON catalog with its text and original name', () => {
    for (const [locale, entries] of Object.entries(resw)) {
      const catalog = catalogs[locale as 'en' | 'es'];
      for (const [key, value] of entries) {
        expect(catalog[key], `${locale} ${key}`).toBe(value);
      }
    }
  });

  it('keeps 271 plain and 333 dotted keys, split at the first dot', () => {
    const keys = resw.en.map(([k]) => k);
    expect(keys.filter((k) => !k.includes('.'))).toHaveLength(271);
    expect(keys.filter((k) => k.includes('.'))).toHaveLength(333);
    const uids = new Set(
      keys.filter((k) => k.includes('.')).map((k) => k.slice(0, k.indexOf('.'))),
    );
    expect(uids.size).toBe(244);
  });

  it('62 values carry placeholders, with identical index sets in both locales', () => {
    const withPlaceholders = resw.en.filter(([, v]) => /\{\d/.test(v));
    expect(withPlaceholders).toHaveLength(62);
    for (const [key, value] of resw.en) {
      const spanish = resw.es.find(([k]) => k === key)?.[1] ?? '';
      expect(placeholderIndexes(spanish), key).toEqual(placeholderIndexes(value));
    }
  });

  it('keeps the newline of MigrationFailed_Content and the non ASCII characters', () => {
    expect(en.MigrationFailed_Content).toContain('\n');
    expect(es.MigrationFailed_Content).toContain('\n');
    expect(en.Model_SpeedQuality).toContain('·');
    expect(en.Xai_StatusLoadingModels).toContain('…');
    expect(Object.values(en).some((v) => v.includes('—'))).toBe(true);
  });
});

describe('core strings (item 113)', () => {
  it('have 43 keys per locale, the same keys, none empty, same placeholders', () => {
    expect(core.en).toHaveLength(43);
    expect(core.es).toHaveLength(43);
    expect(core.en.map(([k]) => k)).toEqual(core.es.map(([k]) => k));
    for (const [key, value] of core.en) {
      const spanish = core.es.find(([k]) => k === key)?.[1] ?? '';
      expect(value, key).not.toBe('');
      expect(spanish, key).not.toBe('');
      expect(placeholderIndexes(spanish), key).toEqual(placeholderIndexes(value));
      expect(catalogs.en[key], key).toBe(value);
      expect(catalogs.es[key], key).toBe(spanish);
    }
  });

  it('the lookup honors the requested locale (CoreStringsTests)', () => {
    expect(createLookup(catalogs, 'en')('Sample_Greeting')).toBe('Hello');
    expect(createLookup(catalogs, 'es')('Sample_Greeting')).toBe('Hola');
  });
});

describe('format specifiers (item 109, 110)', () => {
  const when = new Date(2026, 10, 3, 15, 4);
  const later = new Date(2026, 10, 4, 9, 30);

  it('Model_SpeedQuality renders the size per locale', () => {
    expect(formatTemplate(en.Model_SpeedQuality, ['Fast', 'Very good', 3.11], 'en')).toBe(
      'Fast · Quality Very good · 3.1 GB download',
    );
    expect(formatTemplate(es.Model_SpeedQuality, ['Rápido', 'Muy buena', 3.11], 'es')).toBe(
      'Rápido · Calidad Muy buena · 3,1 GB de descarga',
    );
  });

  it('Download_ModelProgress renders a whole percent', () => {
    expect(formatTemplate(en.Download_ModelProgress, ['Gemma', 40.4], 'en')).toContain('40');
    expect(formatTemplate(es.Download_ModelProgress, ['Gemma', 99.6], 'es')).toContain('100');
  });

  it('ComingUp_TimeRange renders short times per locale', () => {
    expect(formatTemplate(en.ComingUp_TimeRange, [when, later], 'en')).toMatch(/3:04\s?PM/);
    expect(formatTemplate(es.ComingUp_TimeRange, [when, later], 'es')).toContain('15:04');
    expect(formatTemplate(es.ComingUp_TimeRange, [when, later], 'es')).toContain('9:30');
  });

  it('ComingUp_TimeRangeOtherDay renders the day and two times', () => {
    const text = formatTemplate(en.ComingUp_TimeRangeOtherDay, [later, when, later], 'en');
    expect(text).toContain('Wed, Nov 4');
    expect(text).toMatch(/9:30\s?AM/);
  });

  it('MeetingTitleDateFormat composes into MeetingTitleFormat per locale', () => {
    expect(en.MeetingTitleDateFormat).toBe('d MMM, HH:mm');
    expect(es.MeetingTitleDateFormat).toBe('d MMM, HH:mm');
    expect(meetingTitle(createLookup(catalogs, 'en'), when, 'en')).toBe('Meeting 3 Nov, 15:04');
    expect(meetingTitle(createLookup(catalogs, 'es'), when, 'es')).toMatch(
      /^Reunión 3 nov\.?, 15:04$/,
    );
  });
});

describe('keys the settings domain points at (item 116, 118)', () => {
  const keys = [
    ...UI_LANGUAGE_OPTIONS.map((o) => o.labelKey),
    ...TRANSCRIPTION_LANGUAGES.map((l) => l.labelKey),
    ...SUMMARY_LANGUAGES.map((l) => l.labelKey),
    ...SUMMARY_MODELS.flatMap((m) => [m.speedKey, m.qualityKey, m.useCaseKey]),
    ...Object.values(FIT_LABEL_KEYS),
    ...NOTE_TEMPLATE_BUILT_INS.map((t) => t.labelKey),
    ...Object.values(CLI_STATUS_KEYS),
    ...Object.values(SETTINGS_MESSAGE_KEYS),
    ...SETTINGS_SECTIONS.flatMap((section) =>
      section.headingKey === null ? [] : [section.headingKey],
    ),
    'Xai_FeedbackModel',
    'Xai_FeedbackApiKey',
    'Xai_FeedbackSignedIn',
    'Xai_FeedbackSignedOut',
    'Xai_StatusSuperGrok',
    'Xai_StatusApiKey',
    'Xai_StatusSignedOut',
    'Xai_StatusSignedOutDetail',
    'Xai_StatusLoadingModels',
    'Xai_StatusReady',
    'Xai_StatusErrorTitle',
    'SettingsLanguageRestart_Title',
    'SettingsLanguageRestart_Content',
    'SettingsLanguageRestart_RestartNow',
    'SettingsLanguageRestart_Later',
  ];

  it('exist in both locales', () => {
    for (const key of keys) {
      expect(catalogs.en[key], `en ${key}`).toBeTruthy();
      expect(catalogs.es[key], `es ${key}`).toBeTruthy();
    }
  });
});

describe('B9: catalogs hold keys, so a language change relabels them', () => {
  it('every language name differs between the locales for the same key', () => {
    const t = (locale: 'en' | 'es') => createLookup(catalogs, locale);
    const differing = [...TRANSCRIPTION_LANGUAGES, ...SUMMARY_LANGUAGES].filter(
      (entry) => entry.code !== 'en' || entry.labelKey !== 'LanguageEnglish',
    );
    for (const entry of differing) {
      expect(t('es')(entry.labelKey), entry.code).not.toBe(t('en')(entry.labelKey));
    }
    const fast = SUMMARY_MODELS.map((m) => [t('en')(m.speedKey), t('es')(m.speedKey)]);
    expect(fast.every(([a, b]) => a !== b)).toBe(true);
  });

  it('the model catalog carries no localized text of its own', () => {
    const json = JSON.stringify(SUMMARY_MODELS);
    expect(json).not.toContain('Very fast');
    expect(json).not.toContain('Muy rápido');
  });
});

describe('B16: accessible names are localized', () => {
  it('the three progress names exist in English and Spanish and differ', () => {
    for (const key of [
      SETTINGS_MESSAGE_KEYS.micLevelName,
      SETTINGS_MESSAGE_KEYS.engineDownloadProgressName,
      SETTINGS_MESSAGE_KEYS.speakerDownloadProgressName,
    ]) {
      expect(catalogs.en[key], key).toBeTruthy();
      expect(catalogs.es[key], key).toBeTruthy();
      expect(catalogs.es[key]).not.toBe(catalogs.en[key]);
    }
  });
});

describe('references in the code (item 118, B21)', () => {
  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === 'locales' ? [] : sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  const roots = [
    path.join(repoRoot, 'apps/desktop/src/renderer'),
    path.join(repoRoot, 'apps/desktop/src/main'),
    path.join(repoRoot, 'packages/core/src'),
  ];
  const text = roots.flatMap(sourceFiles).map((file) => fs.readFileSync(file, 'utf8'));

  /** `t('Key')` calls and the `...Key: 'Key'` fields of the catalogs. */
  const referenced = new Set<string>();
  for (const source of text) {
    for (const m of source.matchAll(/\bt\(\s*'([A-Za-z][A-Za-z0-9_.]*)'/g))
      referenced.add(m[1] ?? '');
    for (const m of source.matchAll(/[A-Za-z]*Key:\s*'([A-Za-z][A-Za-z0-9_.]*)'/g)) {
      referenced.add(m[1] ?? '');
    }
  }

  it('every key the code asks for exists in both locales', () => {
    const missing = [...referenced].filter((key) => !(key in catalogs.en) || !(key in catalogs.es));
    expect(missing).toEqual([]);
  });

  it('every hand written Ui_ key is used', () => {
    const unused = Object.keys(uiEn).filter((key) => !text.some((source) => source.includes(key)));
    expect(unused).toEqual([]);
  });
});
