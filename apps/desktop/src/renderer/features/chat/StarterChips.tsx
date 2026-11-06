import type { ChatRecipe } from '@vozella/core';
import { useT } from '../../i18n/I18nProvider';
import { Tooltip } from '../../ui';

export interface StarterChipsProps {
  readonly recipes: readonly ChatRecipe[];
  /** Sends the recipe's prompt at once (with a saved prompt's engine). */
  readonly onPick: (recipe: ChatRecipe) => void;
}

/** Four suggested questions for an empty chat; saved prompts lead. A click sends at once. */
export function StarterChips({ recipes, onPick }: StarterChipsProps) {
  const t = useT();
  if (recipes.length === 0) return null;
  return (
    <ul
      data-testid="ListMeetingChatStarters"
      aria-label={t('Chat_Starters.AutomationProperties.Name')}
      className="flex flex-wrap gap-1.5"
    >
      {recipes.map((recipe) => (
        <li key={recipe.id}>
          <Tooltip content={recipe.prompt} side="top">
            <button
              type="button"
              onClick={() => {
                onPick(recipe);
              }}
              className="h-7 rounded-control border border-hairline px-3 text-ui text-ink transition-colors duration-150 ease-out-quick hover:bg-hover active:bg-pressed"
            >
              {recipe.name}
            </button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
