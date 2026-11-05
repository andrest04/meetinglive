import { Link, useRouterState } from '@tanstack/react-router';
import { Fragment, type ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Icon, cn } from '../../ui';
import { NAV, railRouteOf } from './navigation';

/**
 * The left rail (items 20 to 28). The router is the single source of the selection, so a request
 * from elsewhere moves the rail and the page together (item 28) and the bug 15 drop cannot occur.
 * Choosing the page already showing does nothing; choosing Library on a session returns to the
 * list because the session path is not the library path (item 27). The library slot sits right after
 * Library and takes the free height, which keeps Settings at the bottom without changing DOM order.
 */
export function NavRail({ librarySlot }: { readonly librarySlot?: ReactNode }) {
  const t = useT();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const selected = railRouteOf(pathname);
  return (
    <nav
      aria-label={t('Ui_NavMain')}
      className="app-no-drag flex min-h-0 flex-1 flex-col gap-px px-2 py-2"
    >
      {NAV.map((entry) => {
        const current = entry.to === selected;
        return (
          <Fragment key={entry.to}>
            <Link
              to={entry.to}
              id={entry.automationId}
              data-testid={entry.automationId}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex h-8 shrink-0 items-center gap-2.5 rounded-control px-2.5 text-ui-lg text-ink-muted',
                'transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink',
                'aria-[current=page]:bg-pressed aria-[current=page]:font-medium aria-[current=page]:text-ink',
                'forced-colors:aria-[current=page]:bg-[Highlight] forced-colors:aria-[current=page]:text-[HighlightText]',
              )}
            >
              <Icon icon={entry.icon} />
              {t(entry.label)}
            </Link>
            {entry.to === '/library' ? librarySlot : null}
          </Fragment>
        );
      })}
    </nav>
  );
}
