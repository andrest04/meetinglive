import { isCatalogLocale, type CatalogLocale } from './format';

/** The two screens languages the app ships, as the tags written to `settings.json`. */
export const UI_LANGUAGE_TAGS = ['en-US', 'es'] as const;
export type UiLanguageTag = (typeof UI_LANGUAGE_TAGS)[number];

/**
 * The picker options, in order. Labels are endonyms: they never change with the UI language, so
 * each `labelKey` names a catalog key whose text is the same in every locale (spec 2.1).
 */
export const UI_LANGUAGE_OPTIONS: readonly {
  readonly tag: UiLanguageTag;
  readonly locale: CatalogLocale;
  readonly labelKey: 'Settings_LanguageEnglish' | 'Settings_LanguageSpanish';
}[] = [
  { tag: 'en-US', locale: 'en', labelKey: 'Settings_LanguageEnglish' },
  { tag: 'es', locale: 'es', labelKey: 'Settings_LanguageSpanish' },
];

const isBlank = (value: string | null | undefined): value is null | undefined | '' =>
  value === null || value === undefined || value.trim() === '';

/** A tag may be written with an underscore (`es_ES`); treat it like the hyphen form (B20). */
const hyphenated = (tag: string): string => tag.trim().replaceAll('_', '-');

const primarySubtag = (tag: string): string => hyphenated(tag).split('-')[0] ?? '';

const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

/**
 * The canonical locale tag for a user or OS supplied tag, or `null` when the tag is blank, not
 * well formed, or names a language that does not exist. `null` means leave the current locale
 * alone. Unknown but well formed tags such as `xx` give `null` on every platform (B20).
 */
export function resolveCulture(tag: string | null | undefined): string | null {
  if (isBlank(tag)) return null;
  let canonical: string;
  try {
    const first = Intl.getCanonicalLocales(hyphenated(tag))[0];
    if (first === undefined) return null;
    canonical = first;
    const language = new Intl.Locale(canonical).language;
    if (language.length > 3 || languageNames.of(language) === undefined) return null;
  } catch {
    return null;
  }
  return canonical;
}

/**
 * The first available tag whose primary subtag equals the candidate's, ignoring case. The
 * available tag is returned as written (`es-ES` against `[en-US, es]` gives `es`).
 */
export function matchPrimarySubtag(
  candidate: string | null | undefined,
  available: readonly string[],
): string | null {
  if (isBlank(candidate)) return null;
  const wanted = primarySubtag(candidate).toLowerCase();
  return available.find((tag) => primarySubtag(tag).toLowerCase() === wanted) ?? null;
}

/**
 * The language of the screens: the saved choice when there is one, else the first OS language we
 * ship (matched by primary subtag), else English (spec 4.5). Never writes anything.
 */
export function resolveUiLanguage(
  uiLanguage: string | null | undefined,
  osLanguages: readonly string[],
): UiLanguageTag {
  const available: readonly string[] = UI_LANGUAGE_TAGS;
  const saved = matchPrimarySubtag(uiLanguage, available);
  if (saved !== null) return saved as UiLanguageTag;
  if (isBlank(uiLanguage)) {
    for (const os of osLanguages) {
      const matched = matchPrimarySubtag(os, available);
      if (matched !== null) return matched as UiLanguageTag;
    }
  }
  return 'en-US';
}

export function localeOfUiTag(tag: UiLanguageTag): CatalogLocale {
  return tag === 'es' ? 'es' : 'en';
}

/** The catalog locale for any tag, or `null` when we have no strings for that language. */
export function catalogLocaleFor(tag: string | null | undefined): CatalogLocale | null {
  if (isBlank(tag)) return null;
  const language = primarySubtag(tag).toLowerCase();
  return isCatalogLocale(language) ? language : null;
}
