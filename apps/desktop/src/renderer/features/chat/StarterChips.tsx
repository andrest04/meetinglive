import type { ChatRecipe } from '@vozella/core';
import { useT } from '../../i18n/I18nProvider';
import { Tooltip } from '../../ui';

export interface StarterChipsProps {
  readonly recipes: readonly ChatRecipe[];
  readonly onPick: (prompt: string) => void;
}

/** Four suggested questions for an empty chat. A click sends the recipe prompt at once. */
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
                onPick(recipe.prompt);
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
