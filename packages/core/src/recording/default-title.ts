import { formatCustomDate, formatTemplate, type CatalogLocale } from '../i18n/format';

/** The catalog values behind the default title, per locale. */
export interface TitleCatalog {
  readonly MeetingTitleFormat: string;
  readonly MeetingTitleDateFormat: string;
}

/**
 * `Meeting 2 Nov, 14:05` (spec 2.2). Takes the catalog strings as data and the clock as an
 * argument, so a reset for the next take simply calls it again with the new time (item 189).
 */
export function defaultMeetingTitle(
  now: Date,
  locale: CatalogLocale,
  catalog: TitleCatalog,
): string {
  const when = formatCustomDate(now, catalog.MeetingTitleDateFormat, locale);
  return formatTemplate(catalog.MeetingTitleFormat, [when], locale);
}

/**
 * Both languages' `MeetingTitleFormat`, so a placeholder written in one language is still
 * recognised after the UI language changed (B-1). Feed it to the summaries' title check.
 */
export function placeholderFormats(
  catalogs: Readonly<Record<CatalogLocale, Pick<TitleCatalog, 'MeetingTitleFormat'>>>,
): string[] {
  return [...new Set([catalogs.en.MeetingTitleFormat, catalogs.es.MeetingTitleFormat])];
}
