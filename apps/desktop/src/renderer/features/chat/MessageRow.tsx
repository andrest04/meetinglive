import { Check, Copy, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Icon, IconButton, cn } from '../../ui';
import { MarkdownView, type LinkHandler } from '../summaries/MarkdownView';
import { accessibleMessageText, type ChatRow } from './chat-view-model';

export interface MessageRowProps {
  readonly row: ChatRow;
  readonly onCopy: (text: string) => Promise<boolean>;
  readonly onLink: LinkHandler;
}

/**
 * One message. The user's words sit right in a quiet bubble; the assistant's answer reads as a
 * document under a small role label. The copy button appears only once the answer is complete.
 */
export function MessageRow({ row, onCopy, onLink }: MessageRowProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  if (row.role === 'user') {
    const label = t('Chat_RoleUser');
    return (
      <li aria-label={accessibleMessageText(label, row.text)} className="flex justify-end ps-10">
        <p
          className={cn(
            'max-w-[75%] rounded-card bg-hover px-3 py-1.5 text-ui-lg break-words whitespace-pre-wrap text-ink',
            'select-text forced-colors:border forced-colors:border-[CanvasText]',
          )}
        >
          {row.text}
        </p>
      </li>
    );
  }

  const label = t('Chat_RoleAssistant');
  const thinking = row.pending && row.text === '';
  return (
    <li aria-label={thinking ? label : accessibleMessageText(label, row.text)} className="group">
      <p className="text-ui font-medium text-ink-muted">{label}</p>
      {thinking ? (
        <p className="mt-1 flex items-center gap-2 text-ui-lg text-ink-muted" role="status">
          <Icon icon={Loader2} className="animate-spin motion-reduce:animate-none" />
          {t('Chat_Thinking.Text')}
        </p>
      ) : (
        <MarkdownView
          source={row.text}
          onLink={onLink}
          className={cn(
            'mt-1 text-ui-lg select-text',
            // Headings in an answer stay the size of the text around them, only heavier.
            '[&_h2]:mt-3 [&_h2]:text-ui-lg [&_h3]:mt-3 [&_h3]:text-ui-lg [&_h4]:mt-3 [&_h4]:text-ui-lg',
          )}
        />
      )}
      {!row.pending ? (
        <div className="mt-1 h-7">
          <IconButton
            label={t('Chat_Copy.AutomationProperties.Name')}
            icon={copied ? Check : Copy}
            size="sm"
            data-testid="BtnMeetingChatCopy"
            onClick={() => {
              void onCopy(row.text).then((ok) => {
                setCopied(ok);
              });
            }}
            className="text-ink-muted"
          />
        </div>
      ) : null}
    </li>
  );
}
