import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { reportRendererError } from '../app/error-reporting';
import { readStored, writeStored } from '../app/preference-storage';
import { createTranslator, detectLocale, isLocale, type Locale, type Translate } from './translate';

const STORAGE_KEY = 'vozella.locale';

/** Tells the main log about a missing string once per key and locale. */
function reportMissingOnce(): (key: string, locale: Locale, fallback: 'en' | 'key') => void {
  const seen = new Set<string>();
  return (key, locale, fallback) => {
    const id = locale + ':' + key;
    if (seen.has(id)) return;
    seen.add(id);
    if (typeof window === 'undefined' || !('vozella' in window)) return;
    reportRendererError(
      window.vozella,
      'error',
      new Error('missing string ' + key + ' for ' + locale + ', using ' + fallback),
    );
  };
}

interface I18nValue {
  readonly locale: Locale;
  readonly t: Translate;
  readonly setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (initialLocale) return initialLocale;
    const stored = readStored(STORAGE_KEY);
    return isLocale(stored) ? stored : detectLocale(navigator.languages);
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeStored(STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  const value = useMemo(
    () => ({ locale, t: createTranslator(locale, reportMissingOnce()), setLocale }),
    [locale, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}

export function useT(): Translate {
  return useI18n().t;
}
