/** Shown when a string is formatted. Dates and numbers follow the UI locale, never the machine. */
export type FormatArg = string | number | Date;

/** The catalog locale: a language we ship strings for. */
export const CATALOG_LOCALES = ['en', 'es'] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];

export function isCatalogLocale(value: unknown): value is CatalogLocale {
  return typeof value === 'string' && (CATALOG_LOCALES as readonly string[]).includes(value);
}

/** BCP 47 tag Intl uses for each catalog locale. English is American, as the strings are. */
const INTL_TAG: Readonly<Record<CatalogLocale, string>> = { en: 'en-US', es: 'es' };

export function intlTag(locale: CatalogLocale): string {
  return INTL_TAG[locale];
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function names(
  locale: CatalogLocale,
  field: 'weekday' | 'month',
  style: 'long' | 'short',
  d: Date,
) {
  return new Intl.DateTimeFormat(intlTag(locale), { [field]: style }).format(d);
}

/**
 * Renders the .NET custom date pattern letters this app uses: d dd ddd dddd, M MM MMM MMMM,
 * yy yyyy, H HH h hh, m mm, s ss, tt. Text inside quotes is copied; other characters are copied.
 * Backslash escapes the next character.
 */
export function formatCustomDate(date: Date, pattern: string, locale: CatalogLocale): string {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern.charAt(i);
    if (ch === "'" || ch === '"') {
      const end = pattern.indexOf(ch, i + 1);
      const stop = end === -1 ? pattern.length : end;
      out += pattern.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (ch === '\\') {
      out += pattern.charAt(i + 1);
      i += 2;
      continue;
    }
    let run = 1;
    while (pattern.charAt(i + run) === ch) run += 1;
    i += run;
    switch (ch) {
      case 'd':
        if (run === 1) out += String(date.getDate());
        else if (run === 2) out += pad(date.getDate(), 2);
        else out += names(locale, 'weekday', run === 3 ? 'short' : 'long', date);
        break;
      case 'M':
        if (run === 1) out += String(date.getMonth() + 1);
        else if (run === 2) out += pad(date.getMonth() + 1, 2);
        else out += names(locale, 'month', run === 3 ? 'short' : 'long', date);
        break;
      case 'y':
        out += run <= 2 ? pad(date.getFullYear() % 100, 2) : pad(date.getFullYear(), run);
        break;
      case 'H':
        out += run === 1 ? String(date.getHours()) : pad(date.getHours(), 2);
        break;
      case 'h': {
        const hour = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
        out += run === 1 ? String(hour) : pad(hour, 2);
        break;
      }
      case 'm':
        out += run === 1 ? String(date.getMinutes()) : pad(date.getMinutes(), 2);
        break;
      case 's':
        out += run === 1 ? String(date.getSeconds()) : pad(date.getSeconds(), 2);
        break;
      case 't': {
        const meridiem = date.getHours() < 12 ? 'AM' : 'PM';
        // en-US has AM and PM; Spanish culture data has none for the 24 hour clock.
        out += locale === 'en' ? (run === 1 ? meridiem.slice(0, 1) : meridiem) : '';
        break;
      }
      default:
        out += ch.repeat(run);
    }
  }
  return out;
}

function formatArg(arg: FormatArg, spec: string | undefined, locale: CatalogLocale): string {
  const tag = intlTag(locale);
  if (arg instanceof Date) {
    if (spec === undefined) return new Intl.DateTimeFormat(tag).format(arg);
    // The standard short time pattern: h:mm tt in English, H:mm in Spanish.
    if (spec === 't') {
      return new Intl.DateTimeFormat(tag, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: locale === 'en',
      }).format(arg);
    }
    return formatCustomDate(arg, spec, locale);
  }
  if (typeof arg === 'number' && spec !== undefined) {
    // The source strings only use the .NET patterns "0" and "0.#".
    const digits = spec === '0.#' ? 1 : 0;
    return new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(arg);
  }
  return String(arg);
}

/** Fills .NET style positional placeholders: {0}, {1:t}, {2:0.#}. Missing arguments stay visible. */
export function formatTemplate(
  template: string,
  args: readonly FormatArg[],
  locale: CatalogLocale = 'en',
): string {
  return template.replace(/\{(\d+)(?::([^}]*))?\}/g, (match, index: string, spec?: string) => {
    const arg = args[Number(index)];
    return arg === undefined ? match : formatArg(arg, spec, locale);
  });
}
