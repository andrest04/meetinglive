import type { ChatRecipe } from '@vozella/core';
import { FileDown, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, IconButton, cn } from '../../ui';

export const recipeOptionId = (id: string): string => `chat-recipe-${id}`;
export const RECIPES_LIST_ID = 'ListMeetingChatRecipes';

/** What the menu can do with saved prompts (Phase 5). Unset hides the footer and the row icons. */
export interface RecipeMenuActions {
  readonly onNew: () => void;
  readonly onEdit: (recipe: ChatRecipe) => void;
  readonly onDelete: (recipe: ChatRecipe) => void;
  readonly onImport: () => void;
  readonly onExport: () => void;
  /** False with no saved prompts: there is nothing to export. */
  readonly canExport: boolean;
}

export interface RecipesMenuProps {
  readonly recipes: readonly ChatRecipe[];
  readonly activeIndex: number;
  readonly onPick: (recipe: ChatRecipe) => void;
  readonly actions?: RecipeMenuActions;
  /** Escape inside the footer: close and give the caret back to the composer. */
  readonly onEscape?: () => void;
}

const isMine = (recipe: ChatRecipe): boolean => recipe.owner === 'user';

/**
 * The flyout above the composer: recipe name over a two-line prompt. It is a listbox the textarea
 * points at with aria-activedescendant, so keyboard focus never leaves the message box. Saved
 * prompts lead in their own group; their edit and delete live in the footer for the highlighted
 * prompt (Tab from the composer reaches it) and as hover icons for the pointer.
 */
export function RecipesMenu({ recipes, activeIndex, onPick, actions, onEscape }: RecipesMenuProps) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const id = recipes[activeIndex]?.id;
    if (id === undefined) return;
    document.getElementById(recipeOptionId(id))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, recipes]);

  const mine = recipes.filter(isMine);
  const builtIns = recipes.filter((r) => !isMine(r));
  const active = recipes[activeIndex];
  const activeMine = active !== undefined && isMine(active) ? active : null;

  const option = (recipe: ChatRecipe) => {
    const index = recipes.indexOf(recipe);
    return (
      <li
        key={recipe.id}
        id={recipeOptionId(recipe.id)}
        role="option"
        aria-selected={index === activeIndex}
        data-testid="ItemMeetingChatRecipe"
        data-owner={recipe.owner}
        // Keep the caret in the composer: the click must not move focus.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          onPick(recipe);
        }}
        className={cn(
          'group/recipe relative cursor-default rounded-control px-2.5 py-1.5 select-none hover:bg-hover',
          index === activeIndex && 'bg-hover',
          'forced-colors:aria-selected:bg-[Highlight] forced-colors:aria-selected:text-[HighlightText]',
        )}
      >
        <span
          className={cn(
            'block truncate text-ui-lg font-medium',
            actions && isMine(recipe) && 'pe-14',
          )}
        >
          {recipe.name}
        </span>
        <span className="line-clamp-2 text-ui text-ink-muted forced-colors:text-inherit">
          {recipe.prompt}
        </span>
        {actions && isMine(recipe) ? (
          // Pointer shortcuts only: the keyboard path is the footer, so these stay out of the
          // tab order and out of the option's name.
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity duration-150 ease-out-quick',
              'group-hover/recipe:opacity-100 motion-reduce:transition-none',
              index === activeIndex && 'opacity-100',
            )}
          >
            <IconButton
              label={t('Ui_ChatPromptEdit', recipe.name)}
              icon={Pencil}
              size="sm"
              tooltip={false}
              tabIndex={-1}
              data-testid="BtnChatPromptRowEdit"
              onClick={(event) => {
                event.stopPropagation();
                actions.onEdit(recipe);
              }}
              className="size-6 text-ink-muted"
            />
            <IconButton
              label={t('Ui_ChatPromptDelete', recipe.name)}
              icon={Trash2}
              size="sm"
              tooltip={false}
              tabIndex={-1}
              data-testid="BtnChatPromptRowDelete"
              onClick={(event) => {
                event.stopPropagation();
                actions.onDelete(recipe);
              }}
              className="size-6 text-ink-muted"
            />
          </span>
        ) : null}
      </li>
    );
  };

  const group = (key: string, label: string, items: readonly ChatRecipe[], testId: string) => (
    <li key={key} role="group" aria-labelledby={`chat-recipes-${key}`} data-testid={testId}>
      <div
        id={`chat-recipes-${key}`}
        role="presentation"
        className="px-2.5 pt-1.5 pb-0.5 text-ui font-medium text-ink-muted forced-colors:text-inherit"
      >
        {label}
      </div>
      <ul role="none">{items.map(option)}</ul>
    </li>
  );

  return (
    <div
      data-testid="PopupMeetingChatRecipes"
      className={cn(
        'absolute right-0 bottom-full z-30 mb-1.5 w-80 max-w-full',
        'rounded-overlay border border-hairline bg-paper-raised text-ink shadow-overlay',
        'forced-colors:border-[CanvasText]',
      )}
    >
      {recipes.length === 0 ? (
        <div data-testid="ListMeetingChatRecipes" style={{ maxHeight: 240 }}>
          <p role="status" className="px-3 py-3 text-ui text-ink-muted">
            {t('Chat_NoRecipes.Text')}
          </p>
        </div>
      ) : (
        <ul
          ref={list}
          id={RECIPES_LIST_ID}
          data-testid="ListMeetingChatRecipes"
          role="listbox"
          aria-label={t('Chat_Recipes.AutomationProperties.Name')}
          // A scroller with no focusable child would become a tab stop of its own.
          tabIndex={-1}
          style={{ maxHeight: 240 }}
          className="overflow-y-auto p-1 outline-none"
        >
          {mine.length === 0
            ? builtIns.map(option)
            : [
                group('mine', t('Ui_ChatPromptsMine'), mine, 'GroupChatPromptsMine'),
                ...(builtIns.length > 0
                  ? [
                      group(
                        'builtin',
                        t('Ui_ChatPromptsBuiltIn'),
                        builtIns,
                        'GroupChatPromptsBuiltIn',
                      ),
                    ]
                  : []),
              ]}
        </ul>
      )}
      {actions ? (
        <MenuFooter actions={actions} activeMine={activeMine} {...(onEscape ? { onEscape } : {})} />
      ) : null}
    </div>
  );
}

function MenuFooter({
  actions,
  activeMine,
  onEscape,
}: {
  readonly actions: RecipeMenuActions;
  readonly activeMine: ChatRecipe | null;
  readonly onEscape?: () => void;
}) {
  const t = useT();
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onEscape?.();
  };
  return (
    <div
      data-testid="BarChatPrompts"
      onKeyDown={onKeyDown}
      className="flex flex-col border-t border-hairline px-1 py-1 forced-colors:border-[CanvasText]"
    >
      {activeMine ? (
        <div className="flex items-center gap-1 px-1.5 pb-1">
          <span className="min-w-0 flex-1 truncate text-ui text-ink-muted">{activeMine.name}</span>
          <Button
            size="sm"
            variant="quiet"
            icon={Pencil}
            data-testid="BtnChatPromptEdit"
            aria-label={t('Ui_ChatPromptEdit', activeMine.name)}
            onClick={() => {
              actions.onEdit(activeMine);
            }}
          >
            {t('Ui_ChatPromptEditShort')}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            icon={Trash2}
            data-testid="BtnChatPromptDelete"
            aria-label={t('Ui_ChatPromptDelete', activeMine.name)}
            onClick={() => {
              actions.onDelete(activeMine);
            }}
          >
            {t('Ui_ChatPromptDeleteShort')}
          </Button>
        </div>
      ) : null}
      <div className="flex items-center gap-0.5">
        <Button
          size="sm"
          variant="quiet"
          icon={Plus}
          data-testid="BtnChatPromptNew"
          onClick={actions.onNew}
          className="me-auto"
        >
          {t('Ui_ChatPromptNew')}
        </Button>
        <IconButton
          label={t('Ui_ChatPromptsImport')}
          icon={FileDown}
          size="sm"
          data-testid="BtnChatPromptsImport"
          onClick={actions.onImport}
          className="text-ink-muted"
        />
        <IconButton
          label={t('Ui_ChatPromptsExport')}
          icon={FileUp}
          size="sm"
          disabled={!actions.canExport}
          data-testid="BtnChatPromptsExport"
          onClick={actions.onExport}
          className="text-ink-muted"
        />
      </div>
    </div>
  );
}
