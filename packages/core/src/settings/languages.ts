/**
 * Meeting (transcription) and summary languages. Spec 2.6. Display names are looked up from the
 * string catalog with `labelKey` when they are drawn, never frozen at start up (B9).
 */

export interface LanguageEntry {
  readonly code: string;
  /** Catalog key of the display name. */
  readonly labelKey: string;
  /** The locale the speech engine is asked for (`NemotronLanguageMapper`). */
  readonly engineLocale: string;
}

export const TRANSCRIPTION_LANGUAGES: readonly LanguageEntry[] = [
  { code: 'auto', labelKey: 'LanguageAutoDetect', engineLocale: 'auto' },
  { code: 'en', labelKey: 'LanguageEnglish', engineLocale: 'en-US' },
  { code: 'es', labelKey: 'LanguageSpanish', engineLocale: 'es-US' },
  { code: 'pt', labelKey: 'LanguagePortuguese', engineLocale: 'pt-BR' },
  { code: 'fr', labelKey: 'LanguageFrench', engineLocale: 'fr-FR' },
  { code: 'de', labelKey: 'LanguageGerman', engineLocale: 'de-DE' },
  { code: 'it', labelKey: 'LanguageItalian', engineLocale: 'it-IT' },
  { code: 'nl', labelKey: 'LanguageDutch', engineLocale: 'nl-NL' },
  { code: 'ja', labelKey: 'LanguageJapanese', engineLocale: 'ja-JP' },
  { code: 'zh', labelKey: 'LanguageChinese', engineLocale: 'zh-CN' },
];

export const SUMMARY_LANGUAGES: readonly LanguageEntry[] = [
  { code: 'es', labelKey: 'LanguageSpanish', engineLocale: 'es-US' },
  { code: 'en', labelKey: 'LanguageEnglish', engineLocale: 'en-US' },
];

/** Used when nothing is saved. Spanish has a lower word error rate with an explicit locale than `auto`. */
export const DEFAULT_MEETING_LANGUAGE = 'es';
export const DEFAULT_SUMMARY_LANGUAGE = 'es';

export const normalizeLanguageCode = (code: string | null | undefined): string =>
  (code ?? '').trim().toLowerCase();

/** The speech engine locale for a code. Blank and unknown codes mean `auto`. */
export function engineLocaleFor(code: string | null | undefined): string {
  const wanted = normalizeLanguageCode(code);
  return TRANSCRIPTION_LANGUAGES.find((entry) => entry.code === wanted)?.engineLocale ?? 'auto';
}

/**
 * The code the picker shows and the engine or summarizer uses, so the two always agree (B6):
 * blank gives the default, case and surrounding spaces are ignored, and a code the catalog does
 * not know falls back to `unknown`.
 */
export function resolveLanguageCode(
  stored: string | null | undefined,
  catalog: readonly LanguageEntry[],
  fallbackForBlank: string,
  fallbackForUnknown: string,
): string {
  const wanted = normalizeLanguageCode(stored);
  if (wanted === '') return fallbackForBlank;
  return catalog.some((entry) => entry.code === wanted) ? wanted : fallbackForUnknown;
}

export const resolveMeetingLanguageCode = (stored: string | null | undefined): string =>
  resolveLanguageCode(stored, TRANSCRIPTION_LANGUAGES, DEFAULT_MEETING_LANGUAGE, 'auto');

export const resolveSummaryLanguageCode = (stored: string | null | undefined): string =>
  resolveLanguageCode(
    stored,
    SUMMARY_LANGUAGES,
    DEFAULT_SUMMARY_LANGUAGE,
    DEFAULT_SUMMARY_LANGUAGE,
  );
