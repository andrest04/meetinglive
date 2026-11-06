import { STARTER_COUNT, recipesForScope, type ChatScopeDecision } from '@vozella/core';
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
import { useChatLinks } from './use-chat-links';
import { useRecipeContext } from './use-recipe-context';

/**
 * The AI panel's chat: transcript, suggested questions, the error line and the composer pinned to
 * the bottom. It owns no scope logic; the panel passes the scope it resolved.
 */
export function ChatBody({ scope }: { readonly scope: ChatScopeDecision }) {
  const t = useT();
  const gate = useProviderGate();
  const chat = useChat(scope, gate);
  const { rows, error } = chat.view;
  const onLink = useChatLinks(chat.reportError);
  // A meeting without action items (a talk, a video, a class) leads with the content recipes.
  const context = useRecipeContext(scope);

  // Names are looked up on every render, so a language change relabels the chips (B8).
  const recipes = useMemo(
    () => recipesForScope(scope.kind, (key) => t(key as StringKey), context ?? {}),
    [scope.kind, t, context],
  );
  // No chips until the meeting is read, so they never flip from one set to the other.
  const starters = useMemo(
    () => (context === null ? [] : recipes.slice(0, STARTER_COUNT)),
    [recipes, context],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {rows.length > 0 ? (
        <MessageList rows={rows} onCopy={chat.copy} onLink={onLink} />
      ) : (
        // An empty chat keeps the suggestions and the composer at the bottom of the panel.
        <div className="min-h-0 flex-1" />
      )}
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
        recipes={recipes}
      />
      <ProviderGateDialogs gate={gate} />
    </div>
  );
}
