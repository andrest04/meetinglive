// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  connectLibrary,
  directCounts,
  REFRESH_DEBOUNCE_MS,
  useLibraryStore,
} from './library-store';
import { LibraryFolders, type SidebarLocation } from './LibraryFolders';
import { Providers, folderRecord, installFakeApi, meetingRecord } from './library-test-kit';

const UNI = '11111111-1111-4111-8111-111111111111';
const CALC = '22222222-2222-4222-8222-222222222222';

type Api = ReturnType<typeof installFakeApi>;

const seed = ({ meetings, folders }: Api): void => {
  folders.folders = [folderRecord(UNI, 'Universidad'), folderRecord(CALC, 'Calculo', UNI)];
  meetings.records.set('a', meetingRecord('a', 'Standup', '2026-09-01T09:00:00.0000000+00:00'));
  meetings.records.set(
    'b',
    meetingRecord('b', 'Planning', '2026-09-03T09:00:00.0000000+00:00', { folderId: UNI }),
  );
  meetings.records.set(
    'c',
    meetingRecord('c', 'Review', '2026-09-02T09:00:00.0000000+00:00', { folderId: 'gone' }),
  );
};

const loads = (api: Api): number => api.calls.filter((c) => c.name === 'library.load').length;

function Connected({ location }: { readonly location: SidebarLocation }) {
  return (
    <Providers>
      <LibraryFolders location={location} />
    </Providers>
  );
}

async function mountSidebar(location: SidebarLocation) {
  const api = installFakeApi();
  seed(api);
  const off = connectLibrary();
  render(<Connected location={location} />);
  await screen.findByRole('treeitem', { name: /Universidad/ });
  return { api, off, user: userEvent.setup() };
}

describe('directCounts', () => {
  it('counts each container on its own, with unknown folders in the Inbox', () => {
    const counts = directCounts(
      [folderRecord(UNI, 'Universidad'), folderRecord(CALC, 'Calculo', UNI)] as never,
      [
        { folderId: null },
        { folderId: 'gone' },
        { folderId: UNI },
        { folderId: CALC },
        { folderId: CALC },
      ] as never,
    );
    expect(counts.all).toBe(5);
    expect(counts.inbox).toBe(2);
    expect(counts.byFolder.get(UNI)).toBe(1);
    expect(counts.byFolder.get(CALC)).toBe(2);
  });
});

describe('connectLibrary', () => {
  it('defers the first load, opens on All, and connects only once', async () => {
    const api = installFakeApi();
    seed(api);
    const off = connectLibrary();
    const second = connectLibrary();
    expect(loads(api)).toBe(0);
    await waitFor(() => {
      expect(useLibraryStore.getState().isLoading).toBe(false);
    });
    expect(loads(api)).toBe(1);
    expect(useLibraryStore.getState().view).toEqual({ kind: 'all' });
    expect(useLibraryStore.getState().meetings).toHaveLength(3);
    second();
    off();
    expect(useLibraryStore.getState().meetings).toHaveLength(0);
  });

  it('turns a burst of changes into one load after the debounce', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = installFakeApi();
      seed(api);
      const off = connectLibrary();
      await vi.waitFor(() => {
        expect(useLibraryStore.getState().isLoading).toBe(false);
      });
      const before = loads(api);
      act(() => {
        api.emit('library.changed', { reason: 'meeting' });
        api.emit('library.changed', { reason: 'meeting' });
        api.emit('library.changed', { reason: 'folder' });
      });
      expect(loads(api)).toBe(before);
      await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS + 1);
      await vi.waitFor(() => {
        expect(loads(api)).toBe(before + 1);
      });
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a stored folder, and lands on the Inbox when that folder is gone', async () => {
    const api = installFakeApi();
    seed(api);
    api.workspace.publishSelectedFolder('deleted-folder');
    const off = connectLibrary();
    await waitFor(() => {
      expect(useLibraryStore.getState().isLoading).toBe(false);
    });
    expect(useLibraryStore.getState().view).toEqual({ kind: 'inbox' });
    off();
  });
});

describe('the sidebar', () => {
  it('shows All, Inbox and folders with direct counts', async () => {
    const { off } = await mountSidebar('library');
    expect(screen.getAllByRole('treeitem').map((item) => item.textContent)).toEqual([
      'All 3',
      'Inbox 2',
      'Universidad 1',
    ]);
    expect(screen.getByRole('treeitem', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    off();
  });

  it('highlights the view only on the screens that show it', async () => {
    const { off } = await mountSidebar('elsewhere');
    expect(screen.getByRole('treeitem', { name: /All/ })).toHaveAttribute('aria-selected', 'false');
    off();
  });

  it('a folder chosen from another screen sets the view and goes to the Library', async () => {
    const { api, off, user } = await mountSidebar('elsewhere');
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(useLibraryStore.getState().view).toEqual({ kind: 'folder', id: UNI });
    await waitFor(() => {
      expect(api.actions).toContainEqual({ type: 'navigateTo', tag: 'History' });
    });
    off();
  });

  it('choosing a folder on the Library itself does not navigate', async () => {
    const { api, off, user } = await mountSidebar('library');
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(useLibraryStore.getState().view).toEqual({ kind: 'folder', id: UNI });
    expect(api.actions).not.toContainEqual({ type: 'navigateTo', tag: 'History' });
    off();
  });

  it('right click elsewhere does not move the person; a menu entry does', async () => {
    const { api, off, user } = await mountSidebar('elsewhere');
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: /Universidad/ }),
    });
    const rename = await screen.findByRole('menuitem', { name: 'Rename' });
    expect(useLibraryStore.getState().view).toEqual({ kind: 'all' });
    expect(api.actions).not.toContainEqual({ type: 'navigateTo', tag: 'History' });
    await user.click(rename);
    expect(useLibraryStore.getState().folderRequest).toEqual({ kind: 'rename', folderId: UNI });
    await waitFor(() => {
      expect(api.actions).toContainEqual({ type: 'navigateTo', tag: 'History' });
    });
    off();
  });

  it('All and Inbox have no folder menu', async () => {
    const { off, user } = await mountSidebar('library');
    for (const name of [/All/, /Inbox/]) {
      await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('treeitem', { name }) });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    }
    off();
  });

  it('New folder asks the Library for its dialog', async () => {
    const { api, off, user } = await mountSidebar('elsewhere');
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    expect(useLibraryStore.getState().folderRequest).toEqual({ kind: 'new' });
    await waitFor(() => {
      expect(api.actions).toContainEqual({ type: 'navigateTo', tag: 'History' });
    });
    expect(within(document.body).queryByRole('dialog')).not.toBeInTheDocument();
    off();
  });
});
