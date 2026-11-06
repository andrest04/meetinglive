import type { ChatAttachmentDto } from '@vozella/contracts';
import type { StringKey } from '../../i18n/translate';

type T = (key: StringKey, ...args: (string | number)[]) => string;

/** `812 B`, `244 KB`, `2.3 MB`, in the app language's number format. */
export function formatFileSize(bytes: number, locale: string): string {
  const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  if (bytes < 1024) return `${whole.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${whole.format(bytes / 1024)} KB`;
  return `${one.format(bytes / (1024 * 1024))} MB`;
}

/** The second line of a chip: what is happening, why it failed, or size and length. */
export function attachmentMeta(item: ChatAttachmentDto, t: T, locale: string): string {
  if (item.status === 'reading') return t('Ui_ChatAttachReading');
  if (item.status === 'error') return item.message ?? t('Ui_ChatAttachUnreadable');
  const parts = [formatFileSize(item.sizeBytes, locale)];
  if (item.pages !== null && item.kind === 'pdf') {
    parts.push(item.pages === 1 ? t('Ui_ChatAttachPage') : t('Ui_ChatAttachPages', item.pages));
  }
  if (item.pages !== null && item.kind === 'pptx') {
    parts.push(item.pages === 1 ? t('Ui_ChatAttachSlide') : t('Ui_ChatAttachSlides', item.pages));
  }
  return parts.join(' · ');
}

/** Files a send carries: everything that did not fail. Main waits for the ones still reading. */
export const sendableAttachmentIds = (items: readonly ChatAttachmentDto[]): string[] =>
  items.filter((item) => item.status !== 'error').map((item) => item.id);

/** True when a drag carries files from the system (not text or a link from the page). */
export const dragHasFiles = (types: readonly string[] | DOMStringList | undefined): boolean =>
  types !== undefined && Array.from(types).includes('Files');
