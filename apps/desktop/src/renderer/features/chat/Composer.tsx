import type { ChatRecipe } from '@vozella/core';
import { ArrowUp, BookOpenText, Paperclip, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { SHORTCUTS } from '../../app/shortcuts';
import { Button, IconButton, ShortcutHint, Tooltip, cn } from '../../ui';
import { keyIntent } from './chat-view-model';
import {
  RECIPES_LIST_ID,
  RecipesMenu,
  recipeOptionId,
  type RecipeMenuActions,
} from './RecipesMenu';
import { useRecipesMenu } from './use-recipes-menu';

const MIN_HEIGHT = 32;
const MAX_HEIGHT = 96;

export interface ComposerProps {
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly isSending: boolean;
  /** Saved prompts, then the built-in recipes of the current scope, for the Recipes flyout. */
  readonly recipes: readonly ChatRecipe[];
  /** Opens the file picker. Unset hides the paperclip. */
  readonly onAttach?: () => void;
  /** Saved prompt actions for the flyout footer. Unset hides it. */
  readonly promptActions?: RecipeMenuActions;
  /** A recipe was picked and its prompt is now the draft. */
  readonly onRecipePicked?: (recipe: ChatRecipe) => void;
}

/** The message box: Enter sends, Shift+Enter adds a line, and the box grows to three lines. */
export function Composer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  isSending,
  recipes,
  onAttach,
  promptActions,
  onRecipePicked,
}: ComposerProps) {
  const t = useT();
  const field = useRef<HTMLTextAreaElement>(null);

  const menu = useRecipesMenu({
    draft,
    onDraftChange,
    recipes,
    field,
    ...(onRecipePicked ? { onPicked: onRecipePicked } : {}),
  });
  const wrapper = useRef<HTMLDivElement>(null);
  const { isOpen, close } = menu;

  // Every footer action closes the flyout first; dialogs then give the caret back themselves.
  const actions = useMemo<RecipeMenuActions | undefined>(() => {
    if (!promptActions) return undefined;
    const closing =
      <A extends unknown[]>(run: (...args: A) => void) =>
      (...args: A) => {
        close();
        run(...args);
      };
    return {
      onNew: closing(promptActions.onNew),
      onEdit: closing(promptActions.onEdit),
      onDelete: closing(promptActions.onDelete),
      onImport: closing(promptActions.onImport),
      onExport: closing(promptActions.onExport),
      canExport: promptActions.canExport,
    };
  }, [promptActions, close]);

  // A press outside the composer, or focus leaving it, closes the flyout.
  useEffect(() => {
    if (!isOpen) return;
    const onPress = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('pointerdown', onPress);
    };
  }, [isOpen, close]);

  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${String(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, el.scrollHeight)))}px`;
  }, [draft]);

  const canSend = !isSending && draft.trim() !== '';

  const activeId = menu.visible[menu.activeIndex]?.id;

  return (
    <div
      ref={wrapper}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      className="relative flex min-w-[180px] items-end gap-2 rounded-control border border-border-control bg-paper px-2.5 py-1 focus-within:border-ink"
    >
      <IconButton
        label={t('Chat_Recipes.AutomationProperties.Name')}
        icon={BookOpenText}
        size="sm"
        data-testid="BtnMeetingChatRecipes"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? RECIPES_LIST_ID : undefined}
        onClick={menu.toggle}
        className="mb-0.5"
      />
      {onAttach ? (
        <IconButton
          label={t('Ui_ChatAttach')}
          icon={Paperclip}
          size="sm"
          data-testid="BtnMeetingChatAttach"
          onClick={onAttach}
          className="mb-0.5 -ms-1.5"
        />
      ) : null}
      <textarea
        ref={field}
        id="TxtMeetingChat"
        data-testid="TxtMeetingChat"
        rows={1}
        value={draft}
        placeholder={t('Chat_Composer.PlaceholderText')}
        aria-label={t('Chat_Composer.AutomationProperties.Name')}
        onChange={(event) => {
          onDraftChange(event.target.value);
        }}
        aria-controls={isOpen ? RECIPES_LIST_ID : undefined}
        aria-activedescendant={activeId === undefined ? undefined : recipeOptionId(activeId)}
        onKeyDown={(event) => {
          if (menu.handleKeyDown(event)) return;
          const intent = keyIntent({
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            isComposing: event.nativeEvent.isComposing,
            draft,
            sending: isSending,
          });
          if (intent === 'send') {
            event.preventDefault();
            onSend();
          } else if (intent === 'swallow') {
            event.preventDefault();
          }
        }}
        style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
        className={cn(
          'min-w-0 flex-1 resize-none bg-transparent py-1.5 text-ui-lg leading-5 text-ink outline-none',
          'placeholder:text-ink-faint',
        )}
      />
      {/* After the message box in the DOM, so Tab from it reaches the footer actions. */}
      {isOpen ? (
        <RecipesMenu
          recipes={menu.visible}
          activeIndex={menu.activeIndex}
          onPick={menu.pick}
          {...(actions ? { actions } : {})}
          onEscape={() => {
            close();
            field.current?.focus();
          }}
        />
      ) : null}
      {isSending ? (
        <IconButton
          label={t('Ui_ChatStop')}
          icon={Square}
          size="sm"
          variant="secondary"
          data-testid="BtnMeetingChatStop"
          onClick={onStop}
          className="mb-0.5"
        />
      ) : (
        <Tooltip
          content={
            <ShortcutHint
              label={t('Chat_Send.AutomationProperties.Name')}
              chords={[['Enter'], SHORTCUTS.chatSend.keys]}
            />
          }
        >
          <Button
            id="BtnMeetingChatSend"
            data-testid="BtnMeetingChatSend"
            variant="primary"
            size="sm"
            icon={ArrowUp}
            disabled={!canSend}
            aria-label={t('Chat_Send.AutomationProperties.Name')}
            onClick={onSend}
            className="mb-0.5 px-1.5"
          />
        </Tooltip>
      )}
    </div>
  );
}
