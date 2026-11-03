import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import { EmptyState, Icon, Input, SectionHeader, cn } from '../../ui';

/** Placeholder for the library module: search and the empty state. */
export function LibraryRoute() {
  const t = useT();
  return (
    <section className="flex flex-col gap-6">
      <SectionHeader level={1} title={t('HistoryPage_Title.Text')} />
      <div className="relative">
        <Icon
          icon={Search}
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
        />
        <Input
          type="search"
          aria-label={t('Library_Search.PlaceholderText')}
          placeholder={t('Library_Search.PlaceholderText')}
          className="w-full pl-8"
        />
      </div>
      <EmptyState
        message={t('HistoryPage_Empty.Text')}
        action={
          <Link
            to="/record"
            className={cn(
              'inline-flex h-8 items-center rounded-control border border-border-control px-3 text-ui-lg font-medium',
              'transition-colors duration-150 ease-out-quick hover:bg-hover active:bg-pressed',
            )}
          >
            {t('HistoryPage_EmptyCta.Content')}
          </Link>
        }
      />
    </section>
  );
}
