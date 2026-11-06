import { useLayoutEffect, useRef } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { LinkHandler } from '../summaries/MarkdownView';
import type { ChatRow } from './chat-view-model';
import { MessageRow } from './MessageRow';

/** The transcript: fills the panel's free height, scrolls inside itself and follows the end of the answer. */
export function MessageList({
  rows,
  onCopy,
  onLink,
  onApply,
}: {
  readonly rows: readonly ChatRow[];
  readonly onCopy: (text: string) => Promise<boolean>;
  readonly onLink: LinkHandler;
  readonly onApply?: (text: string) => void;
}) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);

  // Every new row and every streamed change moves the view to the end (spec 2.7).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
      <ul
        data-testid="ListMeetingChat"
        aria-label={t('Chat_Transcript.AutomationProperties.Name')}
        className="flex flex-col gap-4 py-1 pe-1"
      >
        {rows.map((row) => (
          <MessageRow
            key={row.id}
            row={row}
            onCopy={onCopy}
            onLink={onLink}
            {...(onApply ? { onApply } : {})}
          />
        ))}
      </ul>
    </div>
  );
}
