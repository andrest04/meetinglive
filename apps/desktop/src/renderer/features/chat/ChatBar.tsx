import { ChevronUp, MessageSquarePlus } from 'lucide-react';
import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import type { ChatScopeDecision } from '@vozella/core';
import { useT } from '../../i18n/I18nProvider';
import { Icon, cn } from '../../ui';
import { SCOPE_ICON, scopeLabel } from './chat-scope-label';
import { useChatScope } from './use-chat-scope';

export interface ChatBarProps {
  /** The expanded body (messages, composer). Rendered only while the bar is open. */
  readonly children?: ReactNode | ((scope: ChatScopeDecision) => ReactNode);
}

/**
 * The chat bar docked under the page content (spec 2.1). Hidden on Settings, collapsed at start,
 * and collapsed again whenever the scope changes. The header toggles it; New chat opens it.
 */
export function ChatBar({ children }: ChatBarProps) {
  const t = useT();
  const { decision, name, canStartNewChat } = useChatScope();
  const [expanded, setExpanded] = useState(false);
  // A new chat remounts the body, which drops its draft and error with the old messages.
  const [epoch, setEpoch] = useState(0);
  const bodyId = useId();
  const labelId = useId();

  const { isVisible, kind, folderId, meetingId } = decision;
  useEffect(() => {
    setExpanded(false);
  }, [isVisible, kind, folderId, meetingId]);

  if (!isVisible) return null;

  const label = scopeLabel(t, decision, name);
  const startNewChat = (): void => {
    void window.vozella
      .invoke('chat.newChat', {})
      .then((result) => {
        if (result.started) {
          setEpoch((value) => value + 1);
          setExpanded(true);
        }
      })
      .catch(() => undefined);
  };

  return (
    <section
      id="BarMeetingChat"
      data-testid="BarMeetingChat"
      aria-label={t('Chat_Bar.AutomationProperties.Name')}
      className="shrink-0 border-t border-hairline bg-paper-raised forced-colors:border-[CanvasText]"
    >
      <div className="mx-auto flex w-full max-w-[720px] items-center gap-1 px-8 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          onClick={() => {
            setExpanded((open) => !open);
          }}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-start text-ui-lg',
            'transition-colors duration-150 ease-out-quick hover:bg-hover',
          )}
        >
          <Icon icon={SCOPE_ICON[kind]} className="text-ink-muted" />
          <span
            id={labelId}
            data-testid="LblMeetingChatScope"
            className="min-w-0 flex-1 truncate font-medium"
          >
            {label}
          </span>
          <Icon
            icon={ChevronUp}
            size={14}
            className={cn(
              'text-ink-muted transition-transform duration-150 ease-out-quick',
              expanded && 'rotate-180',
            )}
          />
        </button>
        <button
          type="button"
          id="BtnMeetingChatNew"
          data-testid="BtnMeetingChatNew"
          disabled={!canStartNewChat}
          aria-label={t('Chat_New.AutomationProperties.Name')}
          title={t('Chat_New.ToolTipService.ToolTip')}
          onClick={startNewChat}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-muted',
            'transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink',
            'disabled:opacity-40 disabled:hover:bg-transparent',
          )}
        >
          <Icon icon={MessageSquarePlus} />
        </button>
      </div>
      {expanded ? (
        <div
          id={bodyId}
          className="mx-auto flex max-h-[min(560px,60vh)] w-full max-w-[720px] animate-fade-in flex-col px-10 pb-4"
        >
          <Fragment key={epoch}>
            {typeof children === 'function' ? children(decision) : children}
          </Fragment>
        </div>
      ) : null}
    </section>
  );
}
