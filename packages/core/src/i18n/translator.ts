import { formatTemplate, type CatalogLocale, type FormatArg } from './format';

export type Catalog = Readonly<Partial<Record<string, string>>>;
export type Catalogs = Readonly<Record<CatalogLocale, Catalog>>;

/** Called once per lookup that did not find the key in the requested locale. */
export type MissingKeyReport = (key: string, locale: CatalogLocale, fallback: 'en' | 'key') => void;

export type TranslateFn = (key: string, ...args: FormatArg[]) => string;

/**
 * Looks a key up in the locale, then in English, then falls back to the key itself (B8: never an
 * empty string). Every miss is reported so a missing translation is visible in the log.
 * The locale is explicit: nothing here reads a global culture.
 */
export function createLookup(
  catalogs: Catalogs,
  locale: CatalogLocale,
  onMissing?: MissingKeyReport,
): TranslateFn {
  return (key, ...args) => {
    let template = catalogs[locale][key];
    if (template === undefined) {
      template = locale === 'en' ? undefined : catalogs.en[key];
      onMissing?.(key, locale, template === undefined ? 'key' : 'en');
    }
    const text = template ?? key;
    return args.length === 0 ? text : formatTemplate(text, args, locale);
  };
}

/** The meeting title the app gives a recording with no calendar title (spec 4.3). */
export function meetingTitle(translate: TranslateFn, when: Date, locale: CatalogLocale): string {
  return translate(
    'MeetingTitleFormat',
    formatTemplate('{0:' + translate('MeetingTitleDateFormat') + '}', [when], locale),
  );
}
