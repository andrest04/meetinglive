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
import { SettingsRoute } from '../features/settings/SettingsRoute';
import { AppShell } from '../features/shell/AppShell';

const rootRoute = createRootRoute({ component: AppShell });

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
  settingsRoute,
  galleryRoute,
]);

// Hash history: the page is served from a custom scheme, so path routing has nothing to resolve.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
