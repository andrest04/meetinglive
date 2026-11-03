import { cn } from '../../ui';

export interface RelatedMeetingView {
  readonly id: string;
  readonly title: string;
  /** Already formatted for the person's locale. */
  readonly dateLabel: string;
}

/** A caption and a short row of meetings that share the series or the title. */
export function RelatedMeetings({
  items,
  caption,
  onOpen,
}: {
  readonly items: readonly RelatedMeetingView[];
  readonly caption: string;
  readonly onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={caption} className="flex min-w-0 flex-col gap-1.5">
      <p aria-hidden="true" className="text-ui text-ink-muted">
        {caption}
      </p>
      <ul
        data-testid="ListRelatedMeetings"
        className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1.5"
      >
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <button
              type="button"
              onClick={() => {
                onOpen(item.id);
              }}
              className={cn(
                'flex max-w-[220px] flex-col items-start rounded-control border border-hairline px-3 py-1.5 text-start',
                'transition-colors duration-150 ease-out-quick hover:bg-hover active:bg-pressed',
                'forced-colors:border-[CanvasText]',
              )}
            >
              <span className="max-w-full truncate text-ui-lg text-ink">{item.title}</span>
              <span className="font-mono text-ui text-ink-muted">{item.dateLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
