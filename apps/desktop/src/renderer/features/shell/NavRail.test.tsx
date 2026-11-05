// @vitest-environment jsdom
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { NavRail } from './NavRail';
import { NAV, railRouteOf, routeOfTag, tagOfPath } from './navigation';

afterEach(cleanup);

async function mount(initial: string, locale: 'en' | 'es' = 'en') {
  const root = createRootRoute({
    component: () => (
      <Providers locale={locale}>
        <NavRail />
        <Outlet />
      </Providers>
    ),
  });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{`page ${path}`}</p> });
  const router = createRouter({
    routeTree: root.addChildren([
      page('/record'),
      page('/library'),
      page('/session'),
      page('/settings'),
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  await act(async () => {
    render(<RouterProvider router={router} />);
    await router.load();
  });
  return router;
}

const current = () =>
  screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.id);

describe('navigation shell (items 20 to 28)', () => {
  it('lists Record, Library and Settings with the automation ids', async () => {
    await mount('/record');
    expect(screen.getAllByRole('link').map((link) => [link.textContent, link.id])).toEqual([
      ['Record', 'NavItemRecording'],
      ['Library', 'NavItemHistory'],
      ['Settings', 'NavItemSettings'],
    ]);
    expect(screen.getByTestId('NavItemSettings')).toBe(document.getElementById('NavItemSettings'));
    expect(current()).toEqual(['NavItemRecording']);
  });

  it('keeps the DOM order Record, Library, slot, Settings', async () => {
    const root = createRootRoute({
      component: () => (
        <Providers>
          <NavRail librarySlot={<p>the slot</p>} />
        </Providers>
      ),
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    await act(async () => {
      render(<RouterProvider router={router} />);
      await router.load();
    });
    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toBe('RecordLibrarythe slotSettings');
  });

  it('labels follow the app language, Settings included (item 21)', async () => {
    await mount('/record', 'es');
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Grabar',
      'Biblioteca',
      'Configuración',
    ]);
  });

  it('selecting an entry navigates and moves the selection (item 24)', async () => {
    const router = await mount('/record');
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(router.state.location.pathname).toBe('/settings');
    expect(current()).toEqual(['NavItemSettings']);
  });

  it('selecting the page already showing is a no-op (item 25)', async () => {
    const router = await mount('/library');
    const before = router.history.length;
    await userEvent.click(screen.getByRole('link', { name: 'Library' }));
    expect(router.state.location.pathname).toBe('/library');
    expect(router.history.length).toBe(before);
  });

  it('the rail stays on Library while a session shows, and Library returns to the list (items 26, 27)', async () => {
    const router = await mount('/session');
    expect(current()).toEqual(['NavItemHistory']);
    await userEvent.click(screen.getByRole('link', { name: 'Library' }));
    expect(router.state.location.pathname).toBe('/library');
    expect(screen.getByText('page /library')).toBeTruthy();
  });

  it('a programmatic navigation moves the rail with the page (item 28)', async () => {
    const router = await mount('/record');
    await act(async () => {
      await router.navigate({ to: '/session' });
    });
    expect(current()).toEqual(['NavItemHistory']);
    await act(async () => {
      await router.navigate({ to: '/settings' });
    });
    expect(current()).toEqual(['NavItemSettings']);
  });
});

describe('navigation helpers', () => {
  it('maps tags to routes and back', () => {
    expect(routeOfTag('Recording')).toBe('/record');
    expect(routeOfTag('Session')).toBe('/session');
    expect(tagOfPath('/library')).toBe('History');
    expect(tagOfPath('/gallery')).toBeNull();
  });
  it('Session is not on the rail', () => {
    expect(NAV.map((entry) => entry.to)).not.toContain('/session');
    expect(railRouteOf('/session')).toBe('/library');
    expect(railRouteOf('/gallery')).toBeNull();
  });
});
