import { ChevronRight } from 'lucide-react';
import { Icon, cn } from '../../ui';

export interface Crumb {
  /** null is Inbox. */
  readonly id: string | null;
  readonly label: string;
}

export interface BreadcrumbsProps {
  readonly crumbs: readonly Crumb[];
  readonly label: string;
  readonly onSelect: (id: string | null) => void;
}

/** Inbox, then the chain down to the selected folder. The last item is the current place. */
export function Breadcrumbs({ crumbs, label, onSelect }: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className="-ms-1.5 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-ui-lg">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.id ?? 'inbox'} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <Icon icon={ChevronRight} size={12} className="text-ink-faint" /> : null}
              <button
                type="button"
                aria-current={last ? 'page' : undefined}
                onClick={() => {
                  onSelect(crumb.id);
                }}
                className={cn(
                  'max-w-48 truncate rounded-control px-1.5 py-0.5 transition-colors duration-150 ease-out-quick',
                  'hover:bg-hover active:bg-pressed',
                  last ? 'font-medium text-ink' : 'text-ink-muted',
                )}
              >
                {crumb.label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
