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

function formatArg(arg: Arg, spec: string | undefined, locale: Locale): string {
  if (arg instanceof Date) {
    if (spec === 't') return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(arg);
    if (spec === 'ddd, MMM d') {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(arg);
    }
    return new Intl.DateTimeFormat(locale).format(arg);
  }
  if (typeof arg === 'number' && spec !== undefined) {
    // The source strings only use the .NET patterns "0" and "0.#".
    const digits = spec === '0.#' ? 1 : 0;
    return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(arg);
  }
  return String(arg);
}

/** Fills .NET style positional placeholders: {0}, {1:t}, {2:0.#}. Missing arguments stay visible. */
export function format(template: string, args: readonly Arg[], locale: Locale = 'en'): string {
  return template.replace(/\{(\d+)(?::([^}]*))?\}/g, (match, index: string, spec?: string) => {
    const arg = args[Number(index)];
    return arg === undefined ? match : formatArg(arg, spec, locale);
  });
}

export type Translate = (key: StringKey, ...args: Arg[]) => string;

/** Looks the key up in the locale, falls back to English, then to the key itself. */
export function createTranslator(locale: Locale): Translate {
  return (key, ...args) => {
    const template = catalogs[locale][key] ?? catalogs.en[key] ?? key;
    return args.length === 0 ? template : format(template, args, locale);
  };
}
