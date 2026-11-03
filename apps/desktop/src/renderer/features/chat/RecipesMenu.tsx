import type { ChatRecipe } from '@vozella/core';
import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { cn } from '../../ui';

export const recipeOptionId = (id: string): string => `chat-recipe-${id}`;
export const RECIPES_LIST_ID = 'ListMeetingChatRecipes';

export interface RecipesMenuProps {
  readonly recipes: readonly ChatRecipe[];
  readonly activeIndex: number;
  readonly onPick: (recipe: ChatRecipe) => void;
}

/**
 * The flyout above the composer: recipe name over a two-line prompt. It is a listbox the textarea
 * points at with aria-activedescendant, so keyboard focus never leaves the message box.
 */
export function RecipesMenu({ recipes, activeIndex, onPick }: RecipesMenuProps) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const id = recipes[activeIndex]?.id;
    if (id === undefined) return;
    document.getElementById(recipeOptionId(id))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, recipes]);

  return (
    <div
      data-testid="PopupMeetingChatRecipes"
      className={cn(
        'absolute right-0 bottom-full z-30 mb-1.5 w-80 max-w-[calc(100vw-32px)]',
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
          style={{ maxHeight: 240 }}
          className="overflow-y-auto p-1"
        >
          {recipes.map((recipe, index) => (
            <li
              key={recipe.id}
              id={recipeOptionId(recipe.id)}
              role="option"
              aria-selected={index === activeIndex}
              data-testid="ItemMeetingChatRecipe"
              // Keep the caret in the composer: the click must not move focus.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                onPick(recipe);
              }}
              className={cn(
                'cursor-default rounded-control px-2.5 py-1.5 select-none hover:bg-hover',
                index === activeIndex && 'bg-hover',
                'forced-colors:aria-selected:bg-[Highlight] forced-colors:aria-selected:text-[HighlightText]',
              )}
            >
              <span className="block truncate text-ui-lg font-medium">{recipe.name}</span>
              <span className="line-clamp-2 text-ui text-ink-muted forced-colors:text-inherit">
                {recipe.prompt}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
