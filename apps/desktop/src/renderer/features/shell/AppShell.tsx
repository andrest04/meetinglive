import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { CloseDialogs } from '../record/CloseDialogs';
import { connectLiveAsk } from '../record/use-live-ask';
import { connectLibrary } from '../library/library-store';
import { LibraryFolders, type SidebarLocation } from '../library/LibraryFolders';
import { AiPanelArea } from '../chat/AiPanel';
import { ChatBody } from '../chat/ChatBody';
import { CallPromptBar } from './CallPromptBar';
import { Mark, cn } from '../../ui';
import { NavRail } from './NavRail';
import { StartupNotice } from './StartupNotice';
import { routeOfTag, tagOfPath } from './navigation';

/** The shell is the only listener of navigation requests, and tells the workspace where it is. */
function useWorkspaceNavigation(): void {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(
    () =>
      window.vozella.on('workspace.navigationRequested', ({ tag }) => {
        void navigate({ to: routeOfTag(tag) });
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
  // The live answer and the close dialogs belong to the window, not to one page.
  useEffect(() => connectLiveAsk(), []);
  // The sidebar shows the folders on every route, so the library store belongs to the window too.
  useEffect(() => connectLibrary(), []);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Record gets a wider column than the documents; the Library fills the area with its own panes,
  // each scrolling on its own. The elements stay the same, so the page does not remount.
  const paned = pathname === '/library';
  const wide = pathname === '/record';
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
        {/* The AI panel docks to the right of the content column, or floats over it. */}
        <AiPanelArea body={(scope) => <ChatBody scope={scope} />}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Empty chrome: drags the window and sits behind the caption buttons. */}
            <div className="app-drag h-10 shrink-0" />
            <main
              id="content"
              tabIndex={-1}
              className={cn(
                'min-h-0 flex-1 outline-none',
                paned ? 'flex flex-col overflow-hidden' : 'overflow-y-auto pb-8',
              )}
            >
              <div
                className={
                  paned
                    ? 'flex min-h-0 flex-1 flex-col'
                    : cn('mx-auto w-full px-10 pt-8', wide ? 'max-w-[960px]' : 'max-w-[720px]')
                }
              >
                <div className={paned ? 'shrink-0 px-4' : undefined}>
                  <CallPromptBar />
                </div>
                <Outlet />
              </div>
            </main>
          </div>
        </AiPanelArea>
      </div>
      <CloseDialogs />
      <StartupNotice />
    </div>
  );
}

function sidebarLocation(pathname: string): SidebarLocation {
  if (pathname === '/library') return 'library';
  return pathname === '/session' ? 'session' : 'elsewhere';
}

function Sidebar() {
  const t = useT();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <aside className="flex h-full flex-col bg-paper-raised">
      <div className="app-drag flex h-10 shrink-0 items-center gap-2 px-4">
        <Mark size={20} />
        <span className="text-ui-lg font-semibold tracking-[-0.01em]">
          {t('AppTitleBar.Title')}
        </span>
      </div>
      <NavRail librarySlot={<LibraryFolders location={sidebarLocation(pathname)} />} />
    </aside>
  );
}
