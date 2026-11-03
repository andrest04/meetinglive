import {
  createLookup,
  localeOfUiTag,
  resolveUiLanguage,
  type AppSettings,
  type CatalogLocale,
  type Catalogs,
  type MissingKeyReport,
  type TranslateFn,
  type UiLanguageTag,
} from '@vozella/core';

export interface StartupLanguage {
  readonly tag: UiLanguageTag;
  /** True when the user chose it; false when it came from the OS. */
  readonly saved: boolean;
}

/**
 * Spec 4.5: the saved `uiLanguage`, else the first OS language we ship, else English. A settings
 * file that cannot be read leaves the OS default; the app still starts.
 */
export async function resolveStartupLanguage(
  load: () => Promise<AppSettings>,
  osLanguages: readonly string[],
  onError?: (error: unknown) => void,
): Promise<StartupLanguage> {
  let uiLanguage: string | null = null;
  try {
    uiLanguage = (await load()).uiLanguage;
  } catch (error) {
    onError?.(error);
  }
  const saved = uiLanguage !== null && uiLanguage.trim() !== '';
  return { tag: resolveUiLanguage(saved ? uiLanguage : null, osLanguages), saved };
}

/**
 * The language of the main process: core strings, and the locale for numbers and dates. It is a
 * value passed to formatters, never a thread wide culture. The renderer has its own copy, kept in
 * step through `i18n.getLocale` and `i18n.localeChanged`.
 */
export class LocaleState {
  private current: StartupLanguage;
  private lookup: TranslateFn;

  constructor(
    initial: StartupLanguage,
    private readonly catalogs: Catalogs,
    private readonly onMissing?: MissingKeyReport,
  ) {
    this.current = initial;
    this.lookup = createLookup(catalogs, localeOfUiTag(initial.tag), onMissing);
  }

  get tag(): UiLanguageTag {
    return this.current.tag;
  }

  get saved(): boolean {
    return this.current.saved;
  }

  get locale(): CatalogLocale {
    return localeOfUiTag(this.current.tag);
  }

  /** Looks a string up in the current language. Call it at the moment of use, not once at start. */
  readonly t: TranslateFn = (key, ...args) => this.lookup(key, ...args);

  /** After the choice is saved. A choice that failed to save never gets here (B11). */
  set(tag: UiLanguageTag): void {
    this.current = { tag, saved: true };
    this.lookup = createLookup(this.catalogs, localeOfUiTag(tag), this.onMissing);
  }
}
