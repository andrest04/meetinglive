// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatMeetingTime } from './format';
import { useLibraryStore } from './library-store';
import {
  LibraryScreen,
  Providers,
  stubLayout,
  folderRecord,
  installFakeApi,
  meetingRecord,
} from './library-test-kit';

beforeAll(() => {
  // jsdom has no layout: report a wide page so the folder pane is inline.
  class FakeResizeObserver {
    observe(): void {
      // jsdom has no layout to observe.
    }
    disconnect(): void {
      // Nothing was observed.
    }
    unobserve(): void {
      // Nothing was observed.
    }
  }
  globalThis.ResizeObserver = FakeResizeObserver;
  stubLayout();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => pageWidth,
  });
});

let pageWidth = 900;
afterEach(() => {
  pageWidth = 900;
});

function rowOf(name: RegExp): HTMLElement {
  return screen.getByRole('row', { name });
}
function optionAt(options: readonly HTMLElement[], index: number): HTMLElement {
  const option = options[index];
  if (!option) throw new Error('no option ' + String(index));
  return option;
}

const UNI = '11111111-1111-4111-8111-111111111111';
const CALC = '22222222-2222-4222-8222-222222222222';

async function mount(setup?: (api: ReturnType<typeof installFakeApi>) => void) {
  const api = installFakeApi();
  setup?.(api);
  const user = userEvent.setup();
  render(
    <Providers>
      <LibraryScreen />
    </Providers>,
  );
  await waitFor(() => {
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });
  return { api, user };
}

const seed = ({ meetings, folders }: ReturnType<typeof installFakeApi>): void => {
  folders.folders = [
    folderRecord(UNI, 'Universidad', null, { note: 'Fall term', colorKey: 'teal' }),
    folderRecord(CALC, 'Calculo', UNI),
  ];
  meetings.records.set(
    'a',
    meetingRecord('a', 'Standup', '2026-09-01T09:00:00.0000000+00:00', {
      summary: '## Plan\nShip the release',
    }),
  );
  meetings.records.set(
    'b',
    meetingRecord('b', 'Planning', '2026-09-03T09:00:00.0000000+00:00', { folderId: UNI }),
  );
  meetings.records.set(
    'c',
    meetingRecord('c', 'Review', '2026-09-02T09:00:00.0000000+00:00', { folderId: 'gone' }),
  );
};

describe('empty states', () => {
  it('shows the empty library with a way to record', async () => {
    const { api, user } = await mount();
    expect(screen.getByText('No meetings recorded yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record a meeting' }));
    expect(api.actions).toContainEqual({ type: 'navigateTo', tag: 'Recording' });
  });

  it('says so when a folder is empty and when a search matches nothing', async () => {
    const { user } = await mount((api) => {
      seed(api);
      api.meetings.records.delete('b');
    });
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(screen.getByText('This folder is empty.')).toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No meetings match your search.')).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('lists the inbox newest first, with unknown folders filed there, and a snippet', async () => {
    const { user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    const grid = screen.getByRole('grid', { name: 'Library' });
    const rows = within(grid)
      .getAllByRole('row')
      .filter((row) => within(row).queryAllByRole('gridcell').length > 0);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Review'),
      expect.stringContaining('Standup'),
    ]);
    expect(within(rowOf(/Standup/)).getByText('Ship the release')).toBeInTheDocument();
    expect(within(rowOf(/Review/)).getByText('No content yet')).toBeInTheDocument();
  });

  it('filters by title and keeps the query when the folder changes', async () => {
    const { user } = await mount(seed);
    await user.type(screen.getByRole('searchbox'), 'stand');
    expect(rowOf(/Standup/)).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Review/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(screen.getByRole('searchbox')).toHaveValue('stand');
    expect(screen.getByText('No meetings match your search.')).toBeInTheDocument();
  });

  it('opens a meeting on the transcript and the summary through the workspace', async () => {
    const { api, user } = await mount(seed);
    await user.dblClick(rowOf(/Standup/));
    await waitFor(() => {
      expect(api.workspace.state.selectedMeetingId).toBe('a');
    });
    expect(api.actions).toContainEqual({ type: 'openSession', tab: 'Transcript' });

    const row = rowOf(/Review/);
    await user.click(within(row).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Open summary' }));
    await waitFor(() => {
      expect(api.actions).toContainEqual({ type: 'openSession', tab: 'Summary' });
    });
    expect(api.workspace.state.selectedMeetingId).toBe('c');
  });
});

describe('folders', () => {
  it('shows All, then Inbox, and expands only what leads to the selection', async () => {
    await mount(seed);
    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.textContent)).toEqual(['All 3', 'Inbox 2', 'Universidad 1']);
    expect(items[2]).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects a folder, shows its path and its note', async () => {
    const { user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(screen.getByRole('textbox', { name: 'Folder notes' })).toHaveValue('Fall term');
    const crumbs = within(screen.getByRole('navigation', { name: 'Folder' }));
    expect(crumbs.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Inbox',
      'Universidad',
    ]);
    expect(rowOf(/Planning/)).toBeInTheDocument();
    await user.click(crumbs.getByRole('button', { name: 'Inbox' }));
    expect(screen.queryByRole('textbox', { name: 'Folder notes' })).not.toBeInTheDocument();
  });

  it('creates a folder: blocks a blank name, refuses a duplicate, selects the new one', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'New folder' });
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'universidad');
    await user.click(create);
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument();

    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '  Trabajo  {Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const created = (await api.folders.getAll()).find((f) => f.name === 'Trabajo');
    expect(created).toMatchObject({ parentId: null, colorKey: expect.any(String) as unknown });
    expect(await screen.findByRole('treeitem', { name: /Trabajo/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('creates a child of the selected folder and says where', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'New folder in Universidad' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Fisica{Enter}');
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.name === 'Fisica')?.parentId).toBe(UNI);
    });
    expect(await screen.findByRole('treeitem', { name: /Fisica/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Its parent opened so the selection is visible.
    expect(screen.getByRole('treeitem', { name: /Universidad/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('renames from the context menu and keeps the folder selected', async () => {
    const { api, user } = await mount(seed);
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: /Universidad/ }),
    });
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename folder' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Universidad');
    await user.clear(name);
    await user.type(name, 'Estudios{Enter}');
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.id === UNI)?.name).toBe('Estudios');
    });
    expect(await screen.findByRole('treeitem', { name: /Estudios/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('selects the folder under a right click even when the menu is dismissed', async () => {
    const { user } = await mount(seed);
    expect(screen.getByRole('treeitem', { name: /Universidad/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: /Universidad/ }),
    });
    await screen.findByRole('menuitem', { name: 'Rename' });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('treeitem', { name: /Universidad/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('saves the personality with the picked color and icon', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.click(screen.getByRole('button', { name: 'Folder actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Personality' }));
    const dialog = await screen.findByRole('dialog', { name: 'Folder personality' });
    expect(
      within(dialog)
        .getAllByRole('radio', { checked: true })
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['teal', 'folder']);
    expect(within(dialog).getAllByRole('radio')).toHaveLength(7 + 18);
    await user.click(within(dialog).getByRole('radio', { name: 'purple' }));
    await user.click(within(dialog).getByRole('radio', { name: 'book' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.id === UNI)).toMatchObject({
        colorKey: 'purple',
        iconKey: 'book',
      });
    });
  });

  it('refuses to delete a folder that still has contents, and deletes an empty one', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.click(screen.getByRole('button', { name: 'Folder actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete folder' }));
    expect(
      await screen.findByText(
        'This folder still has subfolders or meetings. Empty it before deleting.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(api.folders.folders).toHaveLength(2);
  });

  it('deletes an empty folder after confirming and goes back to Inbox', async () => {
    const { api, user } = await mount((fake) => {
      fake.folders.folders = [folderRecord(UNI, 'Vacia')];
    });
    await user.click(screen.getByRole('treeitem', { name: /Vacia/ }));
    await user.click(screen.getByRole('button', { name: 'Folder actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete folder' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this folder?' });
    expect(
      within(dialog).getByText(
        'This deletes the folder "Vacia". Meetings inside it are not deleted.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(api.folders.folders).toHaveLength(0);
    });
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /Inbox/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(api.workspace.state.selectedFolderId).toBeNull();
  });
});

describe('folder note', () => {
  it('saves when the folder changes, and stores blank as nothing', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    const note = screen.getByRole('textbox', { name: 'Folder notes' });
    await user.clear(note);
    await user.type(note, '  New note  ');
    expect((await api.folders.getAll()).find((f) => f.id === UNI)?.note).toBe('Fall term');
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.id === UNI)?.note).toBe('New note');
    });

    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.clear(screen.getByRole('textbox', { name: 'Folder notes' }));
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.id === UNI)?.note).toBeNull();
    });
  });

  it('stores a typed note after a pause, with no other trigger (B16)', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.type(screen.getByRole('textbox', { name: 'Folder notes' }), ' typed');
    await waitFor(
      async () => {
        expect((await api.folders.getAll()).find((f) => f.id === UNI)?.note).toBe(
          'Fall term typed',
        );
      },
      { timeout: 3000 },
    );
    expect(api.calls.filter((c) => c.name === 'library.setFolderNote')).toHaveLength(1);
  });

  it('saves a typed note when the page is left, and on pagehide', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.type(screen.getByRole('textbox', { name: 'Folder notes' }), ' and more');
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.id === UNI)?.note).toBe(
        'Fall term and more',
      );
    });
    // The change event that follows reloads; it must not save the same note again, forever.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls.filter((c) => c.name === 'library.setFolderNote')).toHaveLength(1);
  });

  it('does not save an unchanged note', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    expect(api.calls.filter((c) => c.name === 'library.setFolderNote')).toHaveLength(0);
  });
});

describe('moving and deleting a meeting', () => {
  it('moves to a folder path, preselecting the current folder', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    const row = rowOf(/Standup/);
    await user.click(within(row).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move meeting' });
    const options = within(dialog).getAllByRole('radio');
    expect(options.map((o) => o.closest('label')?.textContent)).toEqual([
      'Inbox',
      'Universidad',
      'Universidad / Calculo',
    ]);
    expect(options[0]).toBeChecked();
    await user.click(optionAt(options, 2));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => {
      expect(api.meetings.records.get('a')?.folderId).toBe(CALC);
    });
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Standup/ })).not.toBeInTheDocument();
    });
  });

  it('refuses a busy meeting before asking, then deletes after confirming', async () => {
    const { api, user } = await mount(seed);
    api.busy.register({ isBusy: (id) => id === 'a' });
    const row = rowOf(/Standup/);
    await user.click(within(row).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(
      await screen.findByText(
        'This meeting is still being recorded or processed. Try again when it finishes.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.meetings.records.has('a')).toBe(true);

    const other = rowOf(/Review/);
    await user.click(within(other).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    expect(
      within(dialog).getByText('This moves "Review" and its recording to the Recycle Bin.'),
    ).toBeInTheDocument();
    // The safe choice has the focus.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(api.meetings.records.has('c')).toBe(false);
    });
    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Review/ })).not.toBeInTheDocument();
    });
  });

  it('reports a locked recording and keeps the meeting listed', async () => {
    const { api, user } = await mount(seed);
    api.meetings.lockedIds.add('c');
    const row = rowOf(/Review/);
    await user.click(within(row).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/The meeting was not deleted/)).toBeInTheDocument();
    expect(rowOf(/Review/)).toBeInTheDocument();
  });

  it('offers a permanent delete only when the Recycle Bin refused, and asks again', async () => {
    const { api, user } = await mount(seed);
    api.meetings.trashRefusedIds.add('c');
    const row = rowOf(/Review/);
    await user.click(within(row).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const first = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    await user.click(within(first).getByRole('button', { name: 'Delete' }));

    const second = await screen.findByRole('dialog', { name: 'Delete permanently?' });
    expect(
      within(second).getByText(
        '"Review" could not go to the Recycle Bin. A permanent delete cannot be undone.',
      ),
    ).toBeInTheDocument();
    expect(api.meetings.records.has('c')).toBe(true);
    expect(within(second).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(second).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => {
      expect(api.meetings.records.has('c')).toBe(false);
    });
  });

  it('keeps the meeting when the permanent delete is cancelled', async () => {
    const { api, user } = await mount(seed);
    api.meetings.trashRefusedIds.add('c');
    const row = rowOf(/Review/);
    await user.click(within(row).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const first = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    await user.click(within(first).getByRole('button', { name: 'Delete' }));
    const second = await screen.findByRole('dialog', { name: 'Delete permanently?' });
    await user.click(within(second).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(api.meetings.records.has('c')).toBe(true);
  });
});

describe('the All view', () => {
  it('opens on All with every meeting', async () => {
    await mount(seed);
    expect(rowOf(/Planning/)).toBeInTheDocument();
    expect(rowOf(/Standup/)).toBeInTheDocument();
    expect(rowOf(/Review/)).toBeInTheDocument();
  });

  it('asks to record when nothing is recorded, even with folders', async () => {
    await mount((api) => {
      api.folders.folders = [folderRecord(UNI, 'Universidad')];
    });
    expect(screen.getByText('No meetings recorded yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record a meeting' })).toBeInTheDocument();
  });

  it('carries out a folder action asked for from the sidebar', async () => {
    const { user } = await mount(seed);
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    expect(await screen.findByRole('dialog', { name: 'New folder' })).toBeInTheDocument();
    await waitFor(() => {
      expect(useLibraryStore.getState().folderRequest).toBeNull();
    });
  });
});

describe('the grid', () => {
  const noLength = '2026-09-01T09:00:00.0000000+00:00';
  const seedLengths = ({ meetings }: ReturnType<typeof installFakeApi>): void => {
    meetings.records.set(
      'long',
      meetingRecord('long', 'Long', noLength, { endedAt: '2026-09-01T10:00:00.0000000+00:00' }),
    );
    meetings.records.set('open', meetingRecord('open', 'Open', noLength));
  };

  it('is a grid with row counts, day headers and one tab stop', async () => {
    await mount(seed);
    const grid = screen.getByRole('grid', { name: 'Library' });
    // Three days, three meetings.
    expect(grid).toHaveAttribute('aria-rowcount', '6');
    expect(grid).toHaveAttribute('aria-multiselectable', 'true');
    const rows = within(grid).getAllByRole('row');
    expect(rows.map((row) => row.getAttribute('aria-rowindex'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(within(grid).getAllByRole('rowheader')).toHaveLength(3);
    const stops = within(grid)
      .getAllByRole('row')
      .filter((row) => row.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent('Planning');
  });

  it('shows a length and a ruling only for a meeting with an end', async () => {
    await mount(seedLengths);
    const long = rowOf(/Long/);
    expect(within(long).getByText('60 min')).toBeInTheDocument();
    const ruling = long.querySelector<HTMLElement>('[data-ruling]');
    expect(ruling).toHaveAttribute('aria-hidden', 'true');
    // sqrt(60 / 120) of 64 px.
    expect(ruling?.style.width).toBe('45px');
    const open = rowOf(/Open/);
    expect(open.querySelector('[data-ruling]')).toBeNull();
    expect(within(open).queryByText(/min/)).not.toBeInTheDocument();
  });

  it('arrows move the cursor and the focus over headers, and Enter opens', async () => {
    const { api, user } = await mount(seed);
    act(() => {
      rowOf(/Planning/).focus();
    });
    expect(rowOf(/Planning/)).toHaveAttribute('data-cursor', 'true');
    await user.keyboard('{ArrowDown}');
    expect(rowOf(/Review/)).toHaveFocus();
    expect(rowOf(/Review/)).toHaveAttribute('data-cursor', 'true');
    expect(rowOf(/Planning/)).not.toHaveAttribute('data-cursor');
    // Moving previews later; here it does not leave the screen or tell the workspace anything.
    expect(api.actions).not.toContainEqual({ type: 'openSession', tab: 'Transcript' });
    await user.keyboard('{End}');
    expect(rowOf(/Standup/)).toHaveFocus();
    await user.keyboard('{Home}');
    expect(rowOf(/Planning/)).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(api.workspace.state.selectedMeetingId).toBe('b');
    });
  });

  it('Tab goes from the cursor row to its actions, and only those', async () => {
    const { user } = await mount(seed);
    act(() => {
      rowOf(/Planning/).focus();
    });
    await user.tab();
    expect(within(rowOf(/Planning/)).getByRole('button', { name: 'More actions' })).toHaveFocus();
    await user.tab();
    expect(rowOf(/Review/)).not.toHaveFocus();
    expect(within(rowOf(/Review/)).getByRole('button', { name: 'More actions' })).not.toHaveFocus();
  });

  it('a click on a menu entry of a row does not open the meeting', async () => {
    const { api, user } = await mount(seed);
    await user.click(within(rowOf(/Standup/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move' }));
    await screen.findByRole('dialog', { name: 'Move meeting' });
    expect(api.actions).not.toContainEqual({ type: 'openSession', tab: 'Transcript' });
  });

  it('starts again at the top in another view, on its newest meeting', async () => {
    const { user } = await mount(seed);
    act(() => {
      rowOf(/Planning/).focus();
    });
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    expect(useLibraryStore.getState().cursorId).toBe('c');
    expect(useLibraryStore.getState().scrollOffset).toBe(0);
  });
});

describe('the header of the list', () => {
  it('names the view with its count, and has no Library title', async () => {
    const { user } = await mount(seed);
    expect(screen.getByRole('heading', { level: 1, name: 'All' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Library' })).not.toBeInTheDocument();
    expect(screen.getByTestId('library-view-count')).toHaveTextContent('3');
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByTestId('library-view-count')).toHaveTextContent('2');
  });

  it('has breadcrumbs, an actions menu and a note only for a real folder', async () => {
    const { user } = await mount(seed);
    expect(screen.queryByRole('navigation', { name: 'Folder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Folder actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Folder notes' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Universidad' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Folder actions' })).toBeInTheDocument();
    // The note carries its name without a visible label above it.
    expect(screen.getByRole('textbox', { name: 'Folder notes' })).toHaveAttribute(
      'placeholder',
      'Notes for this folder',
    );
    expect(screen.queryByText('Folder notes')).not.toBeInTheDocument();
  });

  it('keeps the count of the view while a search narrows the list', async () => {
    const { user } = await mount(seed);
    await user.type(screen.getByRole('searchbox'), 'stand');
    expect(screen.getByTestId('library-view-count')).toHaveTextContent('3');
  });
});

describe('the panes', () => {
  it('shows the list beside the preview pane when the content is wide enough', async () => {
    pageWidth = 760;
    await mount(seed);
    expect(screen.getByTestId('library-preview')).toBeInTheDocument();
  });

  it('shows only the list below that width, and a click still opens the meeting', async () => {
    pageWidth = 759;
    const { api, user } = await mount(seed);
    expect(screen.queryByTestId('library-preview')).not.toBeInTheDocument();
    await user.click(screen.getByText('Standup'));
    await waitFor(() => {
      expect(api.actions).toContainEqual({ type: 'openSession', tab: 'Transcript' });
    });
  });
});

describe('the preview', () => {
  const preview = (): HTMLElement => screen.getByTestId('library-preview');
  const reads = (api: ReturnType<typeof installFakeApi>) =>
    api.calls.filter((c) => c.name === 'library.getMeeting');

  it('previews the newest meeting on arrival, and a click only moves it', async () => {
    const { api, user } = await mount(seed);
    expect(
      await within(preview()).findByRole('heading', { level: 2, name: 'Planning' }),
    ).toBeInTheDocument();
    await user.click(rowOf(/Standup/));
    expect(
      await within(preview()).findByRole('heading', { level: 2, name: 'Standup' }),
    ).toBeInTheDocument();
    expect(await within(preview()).findByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(rowOf(/Standup/)).toHaveAttribute('data-cursor', 'true');
    expect(api.actions).not.toContainEqual({ type: 'openSession', tab: 'Transcript' });
    // Previewing tells the workspace nothing: selectMeeting emits a scope change on each arrow.
    expect(api.actions.filter((a) => a.type === 'selectMeeting')).toEqual([]);
  });

  it('double click and Open meeting open it', async () => {
    const { api, user } = await mount(seed);
    await user.dblClick(rowOf(/Review/));
    await waitFor(() => {
      expect(api.workspace.state.selectedMeetingId).toBe('c');
    });
    expect(api.actions).toContainEqual({ type: 'openSession', tab: 'Transcript' });

    await user.click(rowOf(/Standup/));
    await within(preview()).findByRole('heading', { level: 2, name: 'Standup' });
    await user.click(within(preview()).getByRole('button', { name: 'Open meeting' }));
    await waitFor(() => {
      expect(api.workspace.state.selectedMeetingId).toBe('a');
    });
    expect(api.actions).toContainEqual({ type: 'openSession', tab: 'Summary' });
  });

  it('says when it happened, in a plain sentence', async () => {
    await mount(({ meetings }) => {
      meetings.records.set(
        'a',
        meetingRecord('a', 'Roadmap', '2026-09-01T10:30:00.0000000+00:00', {
          endedAt: '2026-09-01T11:15:00.0000000+00:00',
        }),
      );
    });
    const start = formatMeetingTime('2026-09-01T10:30:00.0000000+00:00', 'en');
    const end = formatMeetingTime('2026-09-01T11:15:00.0000000+00:00', 'en');
    expect(
      await within(preview()).findByText(new RegExp(`, ${start} to ${end}$`)),
    ).toBeInTheDocument();
  });

  it('shows the start of the transcript when there is no summary, and no tabs', async () => {
    await mount(({ meetings }) => {
      meetings.records.set(
        'a',
        meetingRecord('a', 'Sync', '2026-09-01T09:00:00.0000000+00:00', {
          transcript: '[00:01.00-00:02.00] Hello everyone',
        }),
      );
    });
    expect(await within(preview()).findByText(/Hello everyone/)).toBeInTheDocument();
    expect(within(preview()).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(preview()).queryByText(/00:01/)).not.toBeInTheDocument();
  });

  it('has a tab each when both exist, with action items, attendees and the recording', async () => {
    const { api, user } = await mount(({ meetings }) => {
      meetings.records.set(
        'a',
        meetingRecord('a', 'Sync', '2026-09-01T09:00:00.0000000+00:00', {
          summary: 'Agreed to ship',
          transcript: '[00:01.00-00:02.00] Hello everyone',
          actionItems: [{ text: 'Send the notes', isDone: false }],
          attendees: ['Ana', 'Luis'],
          audioFilePath: 'C:\\Meetings\\Inbox\\sync.wav',
        }),
      );
    });
    expect(await within(preview()).findByText('Agreed to ship')).toBeInTheDocument();
    expect(within(preview()).getByText('Send the notes')).toBeInTheDocument();
    expect(within(preview()).getByText('Ana, Luis')).toBeInTheDocument();
    expect(within(preview()).getByText('sync.wav')).toBeInTheDocument();
    await user.click(within(preview()).getByRole('tab', { name: 'Transcript' }));
    expect(await within(preview()).findByText(/Hello everyone/)).toBeInTheDocument();
    await user.click(within(preview()).getByRole('button', { name: 'Open meeting' }));
    await waitFor(() => {
      expect(api.actions).toContainEqual({ type: 'openSession', tab: 'Transcript' });
    });
  });

  it('waits for the arrows to settle before it reads a meeting', async () => {
    const { api, user } = await mount(seed);
    await within(preview()).findByRole('heading', { level: 2, name: 'Planning' });
    const before = reads(api).length;
    act(() => {
      rowOf(/Planning/).focus();
    });
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(rowOf(/Standup/)).toHaveFocus();
    await within(preview()).findByRole('heading', { level: 2, name: 'Standup' });
    expect(reads(api).length - before).toBe(1);
  });

  it('a slow answer for an earlier row does not replace a later one', async () => {
    const { api, user } = await mount(seed);
    await within(preview()).findByRole('heading', { level: 2, name: 'Planning' });
    const get = api.meetings.get.bind(api.meetings);
    let release: () => void = () => undefined;
    const spy = vi.spyOn(api.meetings, 'get').mockImplementationOnce(async (id) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return get(id);
    });
    await user.click(rowOf(/Review/));
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });
    await user.click(rowOf(/Standup/));
    await within(preview()).findByRole('heading', { level: 2, name: 'Standup' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(within(preview()).getByRole('heading', { level: 2 })).toHaveTextContent('Standup');
  });

  it('uses what it already read, and reads again after a change', async () => {
    const { api, user } = await mount(seed);
    await within(preview()).findByRole('heading', { level: 2, name: 'Planning' });
    await user.click(rowOf(/Standup/));
    await within(preview()).findByRole('heading', { level: 2, name: 'Standup' });
    const before = reads(api).length;
    await user.click(rowOf(/Planning/));
    expect(within(preview()).getByRole('heading', { level: 2 })).toHaveTextContent('Planning');
    expect(reads(api)).toHaveLength(before);

    const record = api.meetings.records.get('b');
    if (!record) throw new Error('no record');
    api.meetings.records.set('b', { ...record, summary: 'Changed elsewhere' });
    api.emit('library.changed', { reason: 'meeting' });
    expect(await within(preview()).findByText('Changed elsewhere')).toBeInTheDocument();
  });

  it('shows a skeleton only when a read takes a while', async () => {
    const { api, user } = await mount(seed);
    await within(preview()).findByRole('heading', { level: 2, name: 'Planning' });
    vi.spyOn(api.meetings, 'get').mockImplementationOnce(() => new Promise(() => undefined));
    await user.click(rowOf(/Standup/));
    expect(within(preview()).queryByRole('status')).not.toBeInTheDocument();
    expect(await within(preview()).findByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('says so when the meeting cannot be read', async () => {
    await mount(({ meetings }) => {
      meetings.records.set('a', meetingRecord('a', 'Sync', '2026-09-01T09:00:00.0000000+00:00'));
      vi.spyOn(meetings, 'get').mockResolvedValue(null);
    });
    expect(
      await within(preview()).findByText('This meeting could not be read.'),
    ).toBeInTheDocument();
  });

  it('has nothing to preview in an empty view', async () => {
    await mount();
    expect(preview()).toBeEmptyDOMElement();
  });

  it('does not read anything below the width, where there is no preview', async () => {
    pageWidth = 759;
    const { api } = await mount(seed);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(reads(api)).toEqual([]);
  });
});

describe('the note and the debounced reload', () => {
  it('B16: a character typed while the debounced reload is really in flight is kept', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    let release: (() => void) | null = null;
    const original = api.service.load.bind(api.service);
    vi.spyOn(api.service, 'load').mockImplementationOnce(async () => {
      const stale = await original();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return stale;
    });
    const note = screen.getByRole('textbox', { name: 'Folder notes' });
    await user.type(note, 'A');
    // Unlike the audit test, wait until the reload has passed the debounce and sits on the gate.
    await waitFor(
      () => {
        expect(release).not.toBeNull();
      },
      { timeout: 3000 },
    );
    await user.type(note, 'B');
    (release as unknown as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('textbox', { name: 'Folder notes' })).toHaveValue('Fall termAB');
  });
});
