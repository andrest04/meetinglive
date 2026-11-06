import { STARTER_COUNT, recipesForScope, type ChatScopeDecision } from '@vozella/core';
import { Paperclip } from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { ProviderGateDialogs } from '../summaries/ProviderGateDialogs';
import { useProviderGate } from '../summaries/use-provider-gate';
import { Icon, Notice } from '../../ui';
import { ApplySummaryNotice } from './ApplySummaryNotice';
import { AttachmentChips } from './AttachmentChips';
import { dragHasFiles, sendableAttachmentIds } from './chat-attachments-view';
import { ChatErrorNotice } from './ChatErrorNotice';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { StarterChips } from './StarterChips';
import { useApplyToSummary } from './use-apply-to-summary';
import { useChat } from './use-chat';
import { useChatAttachments } from './use-chat-attachments';
import { useChatLinks } from './use-chat-links';
import { useRecipeContext } from './use-recipe-context';

/**
 * The AI panel's chat: transcript, suggested questions, the error line and the composer pinned to
 * the bottom. It owns no scope logic; the panel passes the scope it resolved.
 */
export function ChatBody({ scope }: { readonly scope: ChatScopeDecision }) {
  const t = useT();
  const gate = useProviderGate();
  const files = useChatAttachments();
  const { current, setNotice } = files;
  const sendFiles = useMemo(
    () => ({ ids: () => sendableAttachmentIds(current()), onNotice: setNotice }),
    [current, setNotice],
  );
  const chat = useChat(scope, gate, sendFiles);
  const drag = useFileDrop((dropped) => void files.drop(dropped));
  const { rows, error } = chat.view;
  const onLink = useChatLinks(chat.reportError);
  const summary = useApplyToSummary(scope.kind === 'Meeting' ? scope.meetingId : null);
  const { apply } = summary;
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
    <div
      data-testid="ZoneMeetingChatDrop"
      className="relative flex h-full min-h-0 flex-col gap-2"
      {...drag.handlers}
    >
      {drag.active ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 grid animate-fade-in place-items-center rounded-overlay border border-dashed border-border-control bg-paper-raised motion-reduce:animate-none forced-colors:border-[CanvasText]"
        >
          <span className="flex items-center gap-2 text-ui-lg text-ink">
            <Icon icon={Paperclip} className="text-ink-muted" />
            {t('Ui_ChatAttachDrop')}
          </span>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <MessageList
          rows={rows}
          onCopy={chat.copy}
          onLink={onLink}
          {...(apply ? { onApply: (text: string) => void apply(text) } : {})}
        />
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
      {summary.notice ? (
        <ApplySummaryNotice
          notice={summary.notice}
          onUndo={() => void summary.undo()}
          onDismiss={summary.dismiss}
        />
      ) : null}
      {error ? <ChatErrorNotice error={error} onDismiss={chat.dismissError} /> : null}
      {files.notice ? (
        <div data-testid="InfoMeetingChatAttachNotice">
          <Notice
            onDismiss={() => {
              setNotice(null);
            }}
            dismissLabel={t('Ui_Close')}
          >
            <p>{files.notice}</p>
          </Notice>
        </div>
      ) : null}
      {!chat.isSending && rows.length === 0 ? (
        <StarterChips recipes={starters} onPick={(prompt) => void chat.send(prompt)} />
      ) : null}
      <AttachmentChips
        items={files.items}
        onRemove={(id) => {
          void files.remove(id).then(() => {
            document.getElementById('TxtMeetingChat')?.focus();
          });
        }}
      />
      <Composer
        onAttach={() => void files.pick()}
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

/**
 * Drag-and-drop of files from the system onto the panel. Only drags that carry files show the
 * overlay; text dragged inside the page is left alone. The paperclip is the keyboard path.
 */
function useFileDrop(onFiles: (files: readonly File[]) => void) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const reset = (): void => {
    depth.current = 0;
    setActive(false);
  };
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      depth.current += 1;
      setActive(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer.types)) return;
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0 || next === null || next instanceof Node) reset();
    },
    onDrop: (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      reset();
      const dropped = Array.from(event.dataTransfer.files);
      if (dropped.length > 0) onFiles(dropped);
    },
  };
  return { active, handlers };
}
