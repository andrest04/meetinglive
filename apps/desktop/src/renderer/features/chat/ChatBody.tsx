import { recipesForScope, type ChatScopeDecision } from '@vozella/core';
import { useMemo } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { ProviderGateDialogs } from '../summaries/ProviderGateDialogs';
import { useProviderGate } from '../summaries/use-provider-gate';
import { ChatErrorNotice } from './ChatErrorNotice';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { StarterChips } from './StarterChips';
import { useChat } from './use-chat';

const STARTER_COUNT = 4;

/**
 * The expanded chat bar: transcript, suggested questions, the error line and the composer. It owns
 * no scope logic; the bar passes the scope it resolved.
 */
export function ChatBody({ scope }: { readonly scope: ChatScopeDecision }) {
  const t = useT();
  const gate = useProviderGate();
  const chat = useChat(scope, gate);
  const { rows, error } = chat.view;

  // Names are looked up on every render, so a language change relabels the chips (B8).
  const starters = useMemo(
    () => recipesForScope(scope.kind, (key) => t(key as StringKey)).slice(0, STARTER_COUNT),
    [scope.kind, t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {rows.length > 0 ? <MessageList rows={rows} onCopy={chat.copy} /> : null}
      {chat.showScopeMismatch ? (
        <p
          role="status"
          data-testid="TxtMeetingChatScopeMismatch"
          className="text-ui text-ink-muted"
        >
          {t('Chat_ScopeMismatch.Text')}
        </p>
      ) : null}
      {error ? <ChatErrorNotice error={error} onDismiss={chat.dismissError} /> : null}
      {!chat.isSending && rows.length === 0 ? (
        <StarterChips recipes={starters} onPick={(prompt) => void chat.send(prompt)} />
      ) : null}
      <Composer
        draft={chat.draft}
        onDraftChange={chat.setDraft}
        onSend={() => void chat.send(chat.draft)}
        onStop={chat.stop}
        isSending={chat.isSending}
      />
      <ProviderGateDialogs gate={gate} />
    </div>
  );
}
