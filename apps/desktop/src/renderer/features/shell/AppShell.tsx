import type { ShellTag } from '@vozella/core';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Library, Mic, Settings, type LucideIcon } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { CallPromptBar } from './CallPromptBar';
import { Icon, Mark, cn } from '../../ui';

// Fixed width: the resizable navigation pane was dropped (owner decision 2026-11-03).
interface NavEntry {
  readonly to: '/record' | '/library' | '/settings';
  readonly label: StringKey;
  readonly icon: LucideIcon;
}

const NAV: readonly NavEntry[] = [
  { to: '/record', label: 'Nav_Record.Content', icon: Mic },
  { to: '/library', label: 'Nav_History.Content', icon: Library },
  { to: '/settings', label: 'Nav_Settings', icon: Settings },
];

const ROUTE_OF_TAG: Readonly<Record<ShellTag, NavEntry['to'] | '/session'>> = {
  Recording: '/record',
  History: '/library',
  Settings: '/settings',
  Session: '/session',
};

function tagOfPath(pathname: string): ShellTag | null {
  const match = (Object.entries(ROUTE_OF_TAG) as [ShellTag, string][]).find(
    ([, route]) => route === pathname,
  );
  return match ? match[0] : null;
}

/** The shell is the only listener of navigation requests, and tells the workspace where it is. */
function useWorkspaceNavigation(): void {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(
    () =>
      window.vozella.on('workspace.navigationRequested', ({ tag }) => {
        void navigate({ to: ROUTE_OF_TAG[tag] });
      }),
    [navigate],
  );

  useEffect(() => {
    const tag = tagOfPath(pathname);
    if (tag) {
      void window.vozella.invoke('workspace.dispatch', {
        action: { type: 'setCurrentShellTag', tag },
      });
    }
  }, [pathname]);
}

/** Window frame: a sidebar and a content area that share the custom title bar strip at the top. */
export function AppShell() {
  const t = useT();
  useWorkspaceNavigation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // The library has a folder pane beside its list, so it gets a wider column than the documents.
  const wide = pathname === '/library';
  return (
    <div className="h-screen bg-paper text-ink">
      <button
        type="button"
        onClick={() => {
          document.getElementById('content')?.focus();
        }}
        className="sr-only z-50 rounded-control bg-ink px-3 py-1.5 text-ui-lg text-on-ink focus:not-sr-only focus:fixed focus:top-1 focus:left-1"
      >
        {t('Ui_SkipToContent')}
      </button>
      <div className="flex h-screen">
        <div className="w-[232px] shrink-0 border-e border-hairline">
          <Sidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Empty chrome: drags the window and sits behind the caption buttons. */}
          <div className="app-drag h-10 shrink-0" />
          <main
            id="content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto pb-16 outline-none"
          >
            <div
              className={cn('mx-auto w-full px-10 pt-8', wide ? 'max-w-[960px]' : 'max-w-[720px]')}
            >
              <CallPromptBar />
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const t = useT();
  return (
    <aside className="flex h-full flex-col bg-paper-raised">
      <div className="app-drag flex h-10 shrink-0 items-center gap-2 px-4">
        <Mark size={20} />
        <span className="text-ui-lg font-semibold tracking-[-0.01em]">
          {t('AppTitleBar.Title')}
        </span>
      </div>
      <nav aria-label={t('Ui_NavMain')} className="app-no-drag flex flex-col gap-px px-2 pt-2">
        {NAV.map((entry) => (
          <Link
            key={entry.to}
            to={entry.to}
            className={cn(
              'flex h-8 items-center gap-2.5 rounded-control px-2.5 text-ui-lg text-ink-muted',
              'transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink',
              'aria-[current=page]:bg-pressed aria-[current=page]:font-medium aria-[current=page]:text-ink',
              'forced-colors:aria-[current=page]:bg-[Highlight] forced-colors:aria-[current=page]:text-[HighlightText]',
            )}
          >
            <Icon icon={entry.icon} />
            {t(entry.label)}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
