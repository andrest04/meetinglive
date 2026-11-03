import { useT } from '../../i18n/I18nProvider';
import { Notice } from '../../ui';
import type { ChatError } from './chat-view-model';

/** The one line under the transcript when an answer failed. Closable; cleared on the next send. */
export function ChatErrorNotice({
  error,
  onDismiss,
}: {
  readonly error: ChatError;
  readonly onDismiss: () => void;
}) {
  const t = useT();
  // The title already says it, so the body drops the repeated "Could not answer." lead.
  const lead = t('Chat_SendFailed', '').trim();
  const body =
    error.titled && lead !== '' && error.message.startsWith(lead)
      ? error.message.slice(lead.length).trim() || error.message
      : error.message;
  return (
    <div data-testid="InfoMeetingChatError" aria-label={t('Chat_Error.AutomationProperties.Name')}>
      <Notice tone="warning" onDismiss={onDismiss} dismissLabel={t('Ui_Close')}>
        {error.titled ? <p className="font-medium">{t('Chat_Error.Title')}</p> : null}
        <p className={error.titled ? 'text-ink-muted' : undefined}>{body}</p>
      </Notice>
    </div>
  );
}
