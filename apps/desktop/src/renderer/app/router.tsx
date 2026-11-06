import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { GalleryRoute } from '../features/gallery/GalleryRoute';
import { LibraryRoute } from '../features/library/LibraryRoute';
import { RecordRoute } from '../features/record/RecordRoute';
import { SessionRoute } from '../features/session/SessionRoute';
import { SettingsRoute } from '../features/settings/SettingsRoute';
import { AppShell } from '../features/shell/AppShell';
import { RouteCrash } from './RootErrorBoundary';

const rootRoute = createRootRoute({ component: AppShell, errorComponent: RouteCrash });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown by design
    throw redirect({ to: '/record' });
  },
});

const recordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/record',
  component: RecordRoute,
});
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  component: LibraryRoute,
});
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session',
  component: SessionRoute,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
});

/** The gallery documents the kit. It exists in development and unpackaged builds, never in a release. */
const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gallery',
  beforeLoad: async () => {
    const info = await window.vozella.invoke('app.getInfo', {});
    if (info.isPackaged) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirects are thrown by design
      throw redirect({ to: '/record' });
    }
  },
  component: GalleryRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  recordRoute,
  libraryRoute,
  sessionRoute,
  settingsRoute,
  galleryRoute,
]);

type AppRouter = ReturnType<typeof createAppRouter>;

// Hash history: the page is served from a custom scheme, so path routing has nothing to resolve.
function createAppRouter() {
  return createRouter({ routeTree, history: createHashHistory() });
}

/**
 * Hot reload re-runs this module whenever a route component cannot be fast refreshed. A
 * fresh router mounted into the live RouterProvider is never loaded (its matches stay
 * empty), so the window went blank. Keep the first router and hand it the new route tree.
 */
function stableRouter(hotData: { router?: AppRouter } | undefined): AppRouter {
  const previous = hotData?.router;
  const next = previous ?? createAppRouter();
  if (previous) {
    previous.update({ ...previous.options, routeTree });
    void previous.invalidate();
  }
  if (hotData) hotData.router = next;
  return next;
}

export const router = stableRouter(import.meta.hot?.data as { router?: AppRouter } | undefined);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
