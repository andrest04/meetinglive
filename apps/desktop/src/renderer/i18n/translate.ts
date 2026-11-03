import { createLookup, formatTemplate, type MissingKeyReport } from '@vozella/core';
import en from './locales/en.json';
import es from './locales/es.json';
import uiEn from './locales/ui.en.json';
import uiEs from './locales/ui.es.json';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
/** Keys converted from the WinUI resources, plus the few `Ui_` keys written by hand for the new shell. */
export type StringKey = keyof typeof en | keyof typeof uiEn;
export type Arg = string | number | Date;

const catalogs: Readonly<Record<Locale, Readonly<Partial<Record<string, string>>>>> = {
  en: { ...en, ...uiEn },
  es: { ...es, ...uiEs },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The first OS language we ship, English otherwise. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

/** Fills .NET style positional placeholders: {0}, {1:t}, {2:0.#}. Missing arguments stay visible. */
export function format(template: string, args: readonly Arg[], locale: Locale = 'en'): string {
  return formatTemplate(template, args, locale);
}

export type Translate = (key: StringKey, ...args: Arg[]) => string;

/**
 * Looks the key up in the locale, falls back to English, then to the key itself. Each miss goes to
 * `onMissing`, so a missing translation is visible somewhere (the provider logs it once).
 */
export function createTranslator(locale: Locale, onMissing?: MissingKeyReport): Translate {
  const lookup = createLookup(catalogs, locale, onMissing);
  return (key, ...args) => lookup(key, ...args);
}
