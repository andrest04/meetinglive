import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Context, ReactNode } from 'react';
import { reportRendererError } from '../app/error-reporting';
import { createTranslator, detectLocale, isLocale, type Locale, type Translate } from './translate';

/** Tells the main log about a missing string once per key and locale. */
export function reportMissingOnce(): (key: string, locale: Locale, fallback: 'en' | 'key') => void {
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
}

// Hot reload re-runs this module. A fresh context would orphan every consumer still
// bound to the old one, so useI18n would throw and blank the window. Reuse it instead.
const I18nContext: Context<I18nValue | null> =
  ((import.meta.hot?.data as Record<string, unknown> | undefined)?.i18nContext as
    Context<I18nValue | null> | undefined) ?? createContext<I18nValue | null>(null);
if (import.meta.hot) (import.meta.hot.data as Record<string, unknown>).i18nContext = I18nContext;

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  // The first paint takes the language from the main process (see main.tsx). The OS
  // language is only the fallback for a window with no bridge (component tests).
  const [locale, setLocale] = useState<Locale>(
    () => initialLocale ?? detectLocale(navigator.languages),
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Main saves the choice first, then tells every window to switch (settings-i18n B11).
  useEffect(() => {
    if (typeof window === 'undefined' || !('vozella' in window)) return undefined;
    return window.vozella.on('i18n.localeChanged', (event) => {
      if (isLocale(event.locale)) setLocale(event.locale);
    });
  }, []);

  const value = useMemo(
    () => ({ locale, t: createTranslator(locale, reportMissingOnce()) }),
    [locale],
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
