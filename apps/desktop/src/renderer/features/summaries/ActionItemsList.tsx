import type { ActionItemDto } from './summary-tab-model';
import { Checkbox, cn } from '../../ui';

export interface ActionItemsListProps {
  readonly items: readonly ActionItemDto[];
  /** The visible "Action items" heading. */
  readonly heading: string;
  readonly onToggle: (index: number, done: boolean) => void;
}

/** One checkbox per item under a heading. The text is read-only; only the done state changes. */
export function ActionItemsList({ items, heading, onToggle }: ActionItemsListProps) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="summary-action-items" className="mt-9 border-t border-hairline pt-5">
      <h2 id="summary-action-items" className="text-read font-semibold">
        {heading}
      </h2>
      <ul data-testid="ListActionItems" className="mt-3 flex flex-col gap-2.5">
        {items.map((item, index) => (
          <li key={index}>
            <Checkbox
              checked={item.isDone}
              onCheckedChange={(checked) => {
                onToggle(index, checked);
              }}
              label={
                <span className={cn('text-read', item.isDone && 'text-ink-muted line-through')}>
                  {item.text}
                </span>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
