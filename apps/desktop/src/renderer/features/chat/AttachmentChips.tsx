import type { ChatAttachmentDto } from '@vozella/contracts';
import {
  CircleAlert,
  FileText,
  FileType,
  Image as ImageIcon,
  LoaderCircle,
  Presentation,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';
import { Icon, cn } from '../../ui';
import { attachmentMeta } from './chat-attachments-view';

const KIND_ICON: Readonly<Record<ChatAttachmentDto['kind'], LucideIcon>> = {
  pdf: FileType,
  docx: FileText,
  pptx: Presentation,
  text: FileText,
  image: ImageIcon,
};

export interface AttachmentChipsProps {
  readonly items: readonly ChatAttachmentDto[];
  readonly onRemove: (id: string) => void;
}

/**
 * The files attached to the conversation, above the composer: kind, name, size or the reason it
 * failed, and a remove button. Presentational; the panel owns the list.
 */
export function AttachmentChips({ items, onRemove }: AttachmentChipsProps) {
  const { t, locale } = useI18n();
  if (items.length === 0) return null;
  return (
    <ul
      data-testid="ListMeetingChatAttachments"
      aria-label={t('Ui_ChatAttachList')}
      className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto"
    >
      {items.map((item) => {
        const failed = item.status === 'error';
        const reading = item.status === 'reading';
        const meta = attachmentMeta(item, t, locale);
        return (
          <li
            key={item.id}
            data-status={item.status}
            aria-busy={reading || undefined}
            className={cn(
              'flex max-w-full min-w-0 items-center gap-2 rounded-control border py-1 ps-2 pe-1',
              failed ? 'border-border-control' : 'border-hairline',
              'forced-colors:border-[CanvasText]',
            )}
          >
            <Icon
              icon={failed ? CircleAlert : reading ? LoaderCircle : KIND_ICON[item.kind]}
              className={cn(
                'shrink-0',
                failed ? 'text-ink' : 'text-ink-muted',
                reading && 'animate-spin motion-reduce:animate-none',
              )}
            />
            <span className="flex min-w-0 flex-col">
              <span className="max-w-[220px] truncate text-ui text-ink" title={item.name}>
                {item.name}
              </span>
              <span
                className={cn(
                  'text-caption',
                  failed ? 'max-w-[260px] text-ink' : 'text-ink-muted tabular-nums',
                )}
              >
                {meta}
              </span>
            </span>
            <button
              type="button"
              aria-label={t('Ui_ChatAttachRemove', item.name)}
              onClick={() => {
                onRemove(item.id);
              }}
              className="grid size-6 shrink-0 place-items-center rounded-control text-ink-muted transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink"
            >
              <Icon icon={X} size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
