// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    expect(await screen.findByText('No meetings match your search.')).toBeInTheDocument();
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
    expect(await screen.findByText('No meetings match your search.')).toBeInTheDocument();
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
    // The dialog moves the focus just after it appears.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
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
    // The dialog moves the focus just after it appears.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
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
    // The dialog moves the focus just after it appears.
    await waitFor(() => {
      expect(within(second).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });

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

describe('searching inside meetings', () => {
  const searches = (api: ReturnType<typeof installFakeApi>) =>
    api.calls.filter((c) => c.name === 'library.search');
  const seedBodies = ({ meetings, folders }: ReturnType<typeof installFakeApi>): void => {
    folders.folders = [folderRecord(UNI, 'Universidad')];
    meetings.records.set(
      'heard',
      meetingRecord('heard', 'Standup', '2026-09-03T09:00:00.0000000+00:00', {
        transcript: '[00:01.00-00:02.00] Cerramos el año fiscal',
      }),
    );
    meetings.records.set(
      'written',
      meetingRecord('written', 'Planning', '2026-09-02T09:00:00.0000000+00:00', {
        summary: 'The fiscal plan is ready',
        transcript: '[00:01.00-00:02.00] Hello',
      }),
    );
    meetings.records.set(
      'noted',
      meetingRecord('noted', 'Retro', '2026-09-01T09:00:00.0000000+00:00', {
        notes: 'Ask about fiscal dates',
        transcript: '[00:01.00-00:02.00] Hello',
      }),
    );
    meetings.records.set(
      'named',
      meetingRecord('named', 'Fiscal review', '2026-08-31T09:00:00.0000000+00:00', {
        folderId: UNI,
      }),
    );
    meetings.records.set(
      'other',
      meetingRecord('other', 'Lunch', '2026-08-30T09:00:00.0000000+00:00'),
    );
  };

  it('adds what it finds inside meetings to the title matches, in date order', async () => {
    const { api, user } = await mount(seedBodies);
    await user.type(screen.getByRole('searchbox'), 'fiscal');
    await waitFor(() => {
      expect(screen.getAllByRole('row').filter((row) => row.dataset.rowId).length).toBe(4);
    });
    const ids = screen
      .getAllByRole('row')
      .map((row) => row.dataset.rowId)
      .filter(Boolean);
    expect(ids).toEqual(['heard', 'written', 'noted', 'named']);
    // The debounce waits for the typing to stop.
    expect(searches(api).map((c) => c.input)).toEqual([
      { query: 'fiscal', scope: { kind: 'all' }, requestId: expect.any(Number) as unknown },
    ]);
  });

  it('shows the matching text with the words marked', async () => {
    const { user } = await mount(seedBodies);
    await user.type(screen.getByRole('searchbox'), 'ano fiscal');
    const row = await screen.findByRole('row', { name: /Standup/ });
    const marks = [...row.querySelectorAll('mark')].map((mark) => mark.textContent);
    expect(marks).toEqual(['año', 'fiscal']);
  });

  it('does not look inside for a single character', async () => {
    const { api, user } = await mount(seedBodies);
    await user.type(screen.getByRole('searchbox'), 'f');
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(searches(api)).toEqual([]);
    expect(rowOf(/Fiscal review/)).toBeInTheDocument();
  });

  it('says it is still looking before it says nothing matched', async () => {
    const { api, user } = await mount(seedBodies);
    let release: () => void = () => undefined;
    const search = api.service.search.bind(api.service);
    vi.spyOn(api.service, 'search').mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return search(input);
    });
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('Searching inside meetings')).toBeInTheDocument();
    expect(screen.queryByText('No meetings match your search.')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(searches(api)).toHaveLength(1);
    });
    release();
    expect(await screen.findByText('No meetings match your search.')).toBeInTheDocument();
    expect(screen.queryByText('Searching inside meetings')).not.toBeInTheDocument();
  });

  it('opens a hit on its own tab, and the preview follows', async () => {
    const { api, user } = await mount(seedBodies);
    await user.type(screen.getByRole('searchbox'), 'fiscal');
    const preview = screen.getByTestId('library-preview');
    await user.click(await screen.findByRole('row', { name: /Planning/ }));
    expect(await within(preview).findByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.dblClick(rowOf(/Planning/));
    await waitFor(() => {
      expect(api.actions).toContainEqual({ type: 'openSession', tab: 'Summary' });
    });
    await user.dblClick(rowOf(/Retro/));
    await waitFor(() => {
      expect(api.workspace.state.selectedMeetingId).toBe('noted');
    });
    expect(api.actions.filter((a) => a.type === 'openSession').at(-1)).toEqual({
      type: 'openSession',
      tab: 'Summary',
    });
    await user.dblClick(rowOf(/Standup/));
    await waitFor(() => {
      expect(api.workspace.state.selectedMeetingId).toBe('heard');
    });
    expect(api.actions.filter((a) => a.type === 'openSession').at(-1)).toEqual({
      type: 'openSession',
      tab: 'Transcript',
    });
  });

  it('offers to search everything from a narrower view, and keeps the query', async () => {
    const { user } = await mount(seedBodies);
    await user.type(screen.getByRole('searchbox'), 'fiscal');
    expect(screen.queryByRole('button', { name: 'Search all meetings' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    await screen.findByRole('row', { name: /Standup/ });
    expect(screen.queryByRole('row', { name: /Fiscal review/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search all meetings' }));
    expect(await screen.findByRole('row', { name: /Fiscal review/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('fiscal');
    expect(screen.getByRole('heading', { level: 1, name: 'All' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search all meetings' })).not.toBeInTheDocument();
  });

  it('a slow answer to an old query does not replace a newer one', async () => {
    const { api, user } = await mount(seedBodies);
    let release: () => void = () => undefined;
    const search = api.service.search.bind(api.service);
    vi.spyOn(api.service, 'search').mockImplementationOnce(async () => {
      const old = await search({ query: 'hello', scope: { kind: 'all' }, requestId: 0 });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { ...old, requestId: 1, stale: false };
    });
    await user.type(screen.getByRole('searchbox'), 'hello');
    await waitFor(() => {
      expect(searches(api)).toHaveLength(1);
    });
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'cerramos');
    await screen.findByRole('row', { name: /Standup/ });
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('row', { name: /Planning/ })).not.toBeInTheDocument();
  });

  it('keeps the title matches and says so when looking inside fails', async () => {
    const { api, user } = await mount(seedBodies);
    vi.spyOn(api.service, 'search').mockRejectedValue(new Error('disk gone'));
    await user.type(screen.getByRole('searchbox'), 'fiscal');
    expect(await screen.findByText('Only titles were searched.')).toBeInTheDocument();
    expect(rowOf(/Fiscal review/)).toBeInTheDocument();
  });

  it('clears the search with its button, and the focus stays in the field', async () => {
    const { user } = await mount(seedBodies);
    await user.type(screen.getByRole('searchbox'), 'fiscal');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    expect(rowOf(/Lunch/)).toBeInTheDocument();
  });
});

describe('checking several meetings', () => {
  const check = (name: RegExp): HTMLElement =>
    within(rowOf(name)).getByRole('checkbox', { name: /Select/ });
  const bar = (): HTMLElement => screen.getByRole('toolbar', { name: 'Checked meetings' });
  const seedMany = ({ meetings, folders }: ReturnType<typeof installFakeApi>): void => {
    folders.folders = [folderRecord(UNI, 'Universidad')];
    for (const [id, title, day] of [
      ['a', 'First', '03'],
      ['b', 'Second', '03'],
      ['c', 'Third', '02'],
      ['d', 'Fourth', '01'],
    ] as const) {
      meetings.records.set(id, meetingRecord(id, title, `2026-09-${day}T09:00:00.0000000+00:00`));
    }
  };

  it('a check marks the row as selected and shows the bar; a click does not disturb it', async () => {
    const { user } = await mount(seedMany);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'false');
    await user.click(check(/First/));
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'true');
    expect(check(/First/)).toHaveAttribute('aria-checked', 'true');
    expect(within(bar()).getByText('Checked: 1')).toBeInTheDocument();
    await user.click(rowOf(/Second/));
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/Second/)).toHaveAttribute('aria-selected', 'false');
    expect(rowOf(/Second/)).toHaveAttribute('data-cursor', 'true');
    await user.click(within(bar()).getByRole('button', { name: 'Clear checks' }));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('Ctrl and Shift clicks check, without opening, also below the narrow width', async () => {
    pageWidth = 759;
    const { api, user } = await mount(seedMany);
    await user.keyboard('{Control>}');
    await user.click(rowOf(/First/));
    await user.keyboard('{/Control}{Shift>}');
    await user.click(rowOf(/Third/));
    await user.keyboard('{/Shift}');
    expect(within(bar()).getByText('Checked: 3')).toBeInTheDocument();
    expect(rowOf(/Second/)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/Fourth/)).toHaveAttribute('aria-selected', 'false');
    expect(api.actions).not.toContainEqual({ type: 'openSession', tab: 'Transcript' });
  });

  it('the day header checks its day, and shows when only part of it is', async () => {
    const { user } = await mount(seedMany);
    const day = screen.getAllByRole('checkbox', { name: /Select all from/ })[0];
    if (!day) throw new Error('no day check');
    await user.click(check(/First/));
    expect(day).toHaveAttribute('aria-checked', 'mixed');
    await user.click(day);
    expect(day).toHaveAttribute('aria-checked', 'true');
    expect(within(bar()).getByText('Checked: 2')).toBeInTheDocument();
    await user.click(day);
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('moves the checked meetings together, in one request', async () => {
    const { api, user } = await mount(seedMany);
    await user.click(check(/First/));
    await user.click(check(/Third/));
    await user.click(within(bar()).getByRole('button', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 meetings' });
    await user.click(within(dialog).getByRole('radio', { name: 'Universidad' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => {
      expect(api.meetings.records.get('c')?.folderId).toBe(UNI);
    });
    expect(api.meetings.records.get('a')?.folderId).toBe(UNI);
    expect(api.meetings.records.get('b')?.folderId).toBeNull();
    expect(api.calls.filter((c) => c.name === 'library.moveMeetings')).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });
  });

  it('says how many could not move, and leaves those checked', async () => {
    const { api, user } = await mount(seedMany);
    api.busy.register({ isBusy: (id) => id === 'a' });
    await user.click(check(/First/));
    await user.click(check(/Second/));
    await user.click(within(bar()).getByRole('button', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 meetings' });
    await user.click(within(dialog).getByRole('radio', { name: 'Universidad' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await screen.findByText('1 of 2 meetings could not be moved.')).toBeInTheDocument();
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the work under way and holds the actions until it ends', async () => {
    const { api, user } = await mount(seedMany);
    let release: () => void = () => undefined;
    const run = api.service.deleteMeetings.bind(api.service);
    vi.spyOn(api.service, 'deleteMeetings').mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return run(input);
    });
    await user.click(check(/First/));
    await user.click(check(/Second/));
    await user.click(within(bar()).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 meetings?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await within(bar()).findByText('Deleting 2 meetings')).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(within(bar()).getByRole('button', { name: 'Move' })).toBeDisabled();
    release();
    await waitFor(() => {
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });
    expect(api.meetings.records.has('a')).toBe(false);
  });

  it('offers a permanent delete only for the meetings the Recycle Bin refused', async () => {
    const { api, user } = await mount(seedMany);
    api.meetings.trashRefusedIds.add('b');
    await user.click(check(/First/));
    await user.click(check(/Second/));
    await user.click(within(bar()).getByRole('button', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete 2 meetings?' });
    expect(
      within(dialog).getByText('This moves them and their recordings to the Recycle Bin.'),
    ).toBeInTheDocument();
    // The dialog moves the focus just after it appears.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    dialog = await screen.findByRole('dialog', { name: 'Delete permanently?' });
    expect(
      within(dialog).getByText(
        '1 of these meetings could not go to the Recycle Bin. A permanent delete cannot be undone.',
      ),
    ).toBeInTheDocument();
    expect(api.meetings.records.has('a')).toBe(false);
    expect(api.meetings.records.has('b')).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => {
      expect(api.meetings.records.has('b')).toBe(false);
    });
    expect(
      api.calls.filter((c) => c.name === 'library.deleteMeetings').map((c) => c.input),
    ).toEqual([
      { meetingIds: ['a', 'b'], mode: 'trash' },
      { meetingIds: ['b'], mode: 'permanent' },
    ]);
  });

  it('the row menu acts on the whole set from a checked row, and alone from another', async () => {
    const { user } = await mount(seedMany);
    await user.click(check(/First/));
    await user.click(check(/Second/));
    await user.click(within(rowOf(/First/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog', { name: 'Delete 2 meetings?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await user.click(within(rowOf(/Third/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    expect(within(dialog).getByText(/"Third"/)).toBeInTheDocument();
  });

  it('forgets the checks on another view or another search', async () => {
    const { user } = await mount(seedMany);
    await user.click(check(/First/));
    await user.type(screen.getByRole('searchbox'), 'f');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(check(/First/));
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('a refresh keeps the checks of the meetings still there', async () => {
    const { api, user } = await mount(seedMany);
    await user.click(check(/First/));
    await user.click(check(/Second/));
    api.meetings.records.delete('a');
    api.emit('library.changed', { reason: 'meeting' });
    await waitFor(() => {
      expect(within(bar()).getByText('Checked: 1')).toBeInTheDocument();
    });
    expect(rowOf(/Second/)).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the keyboard', () => {
  const bar = (): HTMLElement => screen.getByRole('toolbar', { name: 'Checked meetings' });
  const seedMany = ({ meetings }: ReturnType<typeof installFakeApi>): void => {
    for (const [id, title, day] of [
      ['a', 'First', '04'],
      ['b', 'Second', '03'],
      ['c', 'Third', '02'],
      ['d', 'Fourth', '01'],
    ] as const) {
      meetings.records.set(id, meetingRecord(id, title, `2026-09-${day}T09:00:00.0000000+00:00`));
    }
  };
  const focusRow = (name: RegExp): void => {
    act(() => {
      rowOf(name).focus();
    });
  };

  it('Space checks the row under the cursor, and again unchecks it', async () => {
    const { user } = await mount(seedMany);
    focusRow(/First/);
    await user.keyboard(' ');
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/First/)).toHaveFocus();
    await user.keyboard(' ');
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'false');
  });

  it('Shift and an arrow grow the range, and coming back shrinks it', async () => {
    const { user } = await mount(seedMany);
    focusRow(/First/);
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    expect(rowOf(/Third/)).toHaveFocus();
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/Second/)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/Third/)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/Fourth/)).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(rowOf(/Third/)).toHaveAttribute('aria-selected', 'false');
    expect(within(bar()).getByText('Checked: 2')).toBeInTheDocument();
  });

  it('an arrow alone moves the cursor and keeps the checks', async () => {
    const { user } = await mount(seedMany);
    focusRow(/First/);
    await user.keyboard(' {ArrowDown}');
    expect(rowOf(/Second/)).toHaveFocus();
    expect(rowOf(/First/)).toHaveAttribute('aria-selected', 'true');
    expect(rowOf(/Second/)).toHaveAttribute('aria-selected', 'false');
  });

  it('Escape clears the checks first, then the search', async () => {
    const { user } = await mount(seedMany);
    await user.type(screen.getByRole('searchbox'), 'r');
    focusRow(/First/);
    await user.keyboard(' ');
    expect(bar()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('r');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(rowOf(/Second/)).toBeInTheDocument();
  });

  it('Ctrl+A checks every row of the list', async () => {
    const { user } = await mount(seedMany);
    focusRow(/First/);
    await user.keyboard('{Control>}a{/Control}');
    expect(within(bar()).getByText('Checked: 4')).toBeInTheDocument();
  });

  it('Ctrl+A waits for the search inside meetings, and checks what it found', async () => {
    const { api, user } = await mount(({ meetings }) => {
      meetings.records.set(
        'a',
        meetingRecord('a', 'Fiscal plan', '2026-09-04T09:00:00.0000000+00:00'),
      );
      meetings.records.set(
        'b',
        meetingRecord('b', 'Sync', '2026-09-03T09:00:00.0000000+00:00', {
          transcript: '[00:01.00-00:02.00] the fiscal year',
        }),
      );
      meetings.records.set('c', meetingRecord('c', 'Lunch', '2026-09-02T09:00:00.0000000+00:00'));
    });
    let release: () => void = () => undefined;
    const search = api.service.search.bind(api.service);
    vi.spyOn(api.service, 'search').mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return search(input);
    });
    await user.type(screen.getByRole('searchbox'), 'fiscal');
    focusRow(/Fiscal plan/);
    await user.keyboard('{Control>}a{/Control}');
    // Still reading: nothing is checked on a partial list.
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'library.search')).toBe(true);
    });
    release();
    expect(await within(await screen.findByRole('toolbar')).findByText('Checked: 2')).toBeVisible();
  });

  it('Ctrl+F goes to the search with its text selected, and Ctrl+A stays its own there', async () => {
    const { user } = await mount(seedMany);
    await user.type(screen.getByRole('searchbox'), 'fi');
    focusRow(/First/);
    await user.keyboard('{Control>}f{/Control}');
    const box = screen.getByRole<HTMLInputElement>('searchbox');
    expect(box).toHaveFocus();
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 2]);
    await user.keyboard('{Control>}a{/Control}');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('ArrowDown goes from the search to the list, and Escape clears the search in place', async () => {
    const { user } = await mount(seedMany);
    const box = screen.getByRole('searchbox');
    await user.type(box, 'fi');
    await waitFor(() => {
      expect(rowOf(/First/)).toHaveAttribute('data-cursor', 'true');
    });
    await user.keyboard('{ArrowDown}');
    expect(rowOf(/First/)).toHaveFocus();
    await user.click(box);
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
  });

  it('F2 renames the meeting under the cursor and the list follows', async () => {
    const { api, user } = await mount(seedMany);
    focusRow(/Second/);
    await user.keyboard('{F2}');
    const dialog = await screen.findByRole('dialog', { name: 'Rename meeting' });
    const field = within(dialog).getByRole('textbox');
    expect(field).toHaveValue('Second');
    await user.clear(field);
    await user.type(field, 'Renamed{Enter}');
    expect(await screen.findByRole('row', { name: /Renamed/ })).toBeInTheDocument();
    expect(api.meetings.records.get('b')?.title).toBe('Renamed');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(rowOf(/Renamed/)).toHaveFocus();
    });
  });

  it('F2 says why when a re-transcription blocks the rename', async () => {
    const { api, user } = await mount(seedMany);
    api.runner.isRunning = true;
    api.runner.meetingId = 'b';
    focusRow(/Second/);
    await user.keyboard('{F2}');
    const dialog = await screen.findByRole('dialog', { name: 'Rename meeting' });
    const field = within(dialog).getByRole('textbox');
    await user.clear(field);
    await user.type(field, 'Renamed{Enter}');
    expect(await within(dialog).findByText(/re-transcription to finish/)).toBeInTheDocument();
    expect(api.meetings.records.get('b')?.title).toBe('Second');
  });

  it('Delete asks about the row, and the next row takes the focus', async () => {
    const { api, user } = await mount(seedMany);
    focusRow(/Second/);
    await user.keyboard('{Delete}');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    expect(within(dialog).getByText(/"Second"/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(api.meetings.records.has('b')).toBe(false);
    });
    await waitFor(() => {
      expect(rowOf(/Third/)).toHaveFocus();
    });
    expect(api.calls.find((c) => c.name === 'library.deleteMeeting')?.input).toEqual({
      meetingId: 'b',
      mode: 'trash',
    });
  });

  it('Delete refused by the bin still offers the permanent delete', async () => {
    const { api, user } = await mount(seedMany);
    api.meetings.trashRefusedIds.add('b');
    focusRow(/Second/);
    await user.keyboard('{Delete}');
    let dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog', { name: 'Delete permanently?' });
    expect(within(dialog).getByText(/could not go to the Recycle Bin/)).toBeInTheDocument();
  });

  it('Delete refuses a busy meeting before asking', async () => {
    const { api, user } = await mount(seedMany);
    api.busy.register({ isBusy: (id) => id === 'b' });
    focusRow(/Second/);
    await user.keyboard('{Delete}');
    expect(await screen.findByText(/still being recorded or processed/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Delete on a checked row asks about the whole set', async () => {
    const { user } = await mount(seedMany);
    focusRow(/First/);
    await user.keyboard(' {ArrowDown} ');
    await user.keyboard('{Delete}');
    expect(await screen.findByRole('dialog', { name: 'Delete 2 meetings?' })).toBeInTheDocument();
  });

  it('Shift+Delete asks for a permanent delete directly, with its own words', async () => {
    const { api, user } = await mount(seedMany);
    focusRow(/Second/);
    await user.keyboard('{Shift>}{Delete}{/Shift}');
    const dialog = await screen.findByRole('dialog', { name: 'Delete permanently?' });
    expect(
      within(dialog).getByText(
        'This deletes "Second" and its recording. A permanent delete cannot be undone.',
      ),
    ).toBeInTheDocument();
    // The dialog moves the focus just after it appears.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => {
      expect(api.meetings.records.has('b')).toBe(false);
    });
    expect(api.calls.find((c) => c.name === 'library.deleteMeeting')?.input).toEqual({
      meetingId: 'b',
      mode: 'permanent',
    });
  });

  it('Shift+Delete on a checked row asks about the set, and refuses nothing silently', async () => {
    const { api, user } = await mount(seedMany);
    focusRow(/First/);
    await user.keyboard(' {ArrowDown} ');
    await user.keyboard('{Shift>}{Delete}{/Shift}');
    const dialog = await screen.findByRole('dialog', { name: 'Delete permanently?' });
    expect(
      within(dialog).getByText(
        'This deletes 2 meetings and their recordings. A permanent delete cannot be undone.',
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => {
      expect(api.meetings.records.has('a')).toBe(false);
    });
    expect(api.calls.find((c) => c.name === 'library.deleteMeetings')?.input).toEqual({
      meetingIds: ['a', 'b'],
      mode: 'permanent',
    });
  });

  it('keys typed in a dialog or a menu do not reach the rows', async () => {
    const { api, user } = await mount(seedMany);
    await user.click(within(rowOf(/First/)).getByRole('button', { name: 'More actions' }));
    await screen.findByRole('menuitem', { name: 'Move' });
    await user.keyboard('{Delete}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    focusRow(/First/);
    await user.keyboard('{F2}');
    const dialog = await screen.findByRole('dialog', { name: 'Rename meeting' });
    await user.keyboard(' {Delete}');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox')).toBeInTheDocument();
    expect(api.calls.some((c) => c.name === 'library.deleteMeeting')).toBe(false);
  });
});

describe('dragging meetings to a folder', () => {
  const TYPE = 'application/x-vozella-meetings';
  const dataTransfer = () => {
    const data = new Map<string, string>();
    return {
      data,
      get types() {
        return [...data.keys()];
      },
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => {
        data.set(type, value);
      },
      getData: (type: string) => data.get(type) ?? '',
      setDragImage: vi.fn(),
    };
  };
  const tree = (name: RegExp): HTMLElement => screen.getByRole('treeitem', { name });
  const seedDrag = ({ meetings, folders }: ReturnType<typeof installFakeApi>): void => {
    folders.folders = [folderRecord(UNI, 'Universidad'), folderRecord(CALC, 'Calculo', UNI)];
    for (const [id, title, day] of [
      ['a', 'First', '04'],
      ['b', 'Second', '03'],
      ['c', 'Third', '02'],
    ] as const) {
      meetings.records.set(id, meetingRecord(id, title, `2026-09-${day}T09:00:00.0000000+00:00`));
    }
  };
  const dragTo = (from: HTMLElement, to: HTMLElement) => {
    const transfer = dataTransfer();
    fireEvent.dragStart(from, { dataTransfer: transfer });
    fireEvent.dragOver(to, { dataTransfer: transfer });
    fireEvent.drop(to, { dataTransfer: transfer });
    fireEvent.dragEnd(from, { dataTransfer: transfer });
    return transfer;
  };

  it('an unchecked row drags alone, even with others checked, and files it', async () => {
    const { api, user } = await mount(seedDrag);
    expect(rowOf(/First/)).toHaveAttribute('draggable', 'true');
    await user.click(within(rowOf(/Second/)).getByRole('checkbox'));
    const transfer = dragTo(rowOf(/First/), tree(/Universidad/));
    expect(transfer.effectAllowed).toBe('move');
    expect(transfer.types).toEqual([TYPE]);
    await waitFor(() => {
      expect(api.meetings.records.get('a')?.folderId).toBe(UNI);
    });
    expect(api.meetings.records.get('b')?.folderId).toBeNull();
    expect(api.calls.find((c) => c.name === 'library.moveMeetings')?.input).toEqual({
      meetingIds: ['a'],
      folderId: UNI,
    });
  });

  it('a checked row drags the whole set, and the ids stay readable during the drag', async () => {
    const { api, user } = await mount(seedDrag);
    await user.click(within(rowOf(/First/)).getByRole('checkbox'));
    await user.click(within(rowOf(/Third/)).getByRole('checkbox'));
    const transfer = dataTransfer();
    fireEvent.dragStart(rowOf(/First/), { dataTransfer: transfer });
    expect(useLibraryStore.getState().draggedIds).toEqual(['a', 'c']);
    expect(transfer.setDragImage).toHaveBeenCalled();
    fireEvent.drop(tree(/Universidad/), { dataTransfer: transfer });
    fireEvent.dragEnd(rowOf(/First/), { dataTransfer: transfer });
    expect(useLibraryStore.getState().draggedIds).toEqual([]);
    await waitFor(() => {
      expect(api.meetings.records.get('c')?.folderId).toBe(UNI);
    });
    expect(api.meetings.records.get('a')?.folderId).toBe(UNI);
    expect(api.meetings.records.get('b')?.folderId).toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });
  });

  it('Inbox is a target and All is not, and only meetings can land', async () => {
    const { api } = await mount(({ meetings, folders }) => {
      seedDrag({ meetings, folders } as never);
      const record = meetings.records.get('a');
      if (record) meetings.records.set('a', { ...record, folderId: UNI });
    });
    const transfer = dataTransfer();
    fireEvent.dragStart(rowOf(/First/), { dataTransfer: transfer });
    // fireEvent says false when the handler called preventDefault, which is what allows a drop.
    expect(fireEvent.dragOver(tree(/^All/), { dataTransfer: transfer })).toBe(true);
    expect(fireEvent.dragOver(tree(/Inbox/), { dataTransfer: transfer })).toBe(false);
    expect(transfer.dropEffect).toBe('move');
    expect(tree(/Inbox/)).toHaveAttribute('data-drop-target', 'true');
    fireEvent.dragLeave(tree(/Inbox/), { dataTransfer: transfer });
    expect(tree(/Inbox/)).not.toHaveAttribute('data-drop-target');
    expect(fireEvent.dragOver(tree(/Inbox/), { dataTransfer: { types: ['text/plain'] } })).toBe(
      true,
    );
    fireEvent.drop(tree(/Inbox/), { dataTransfer: transfer });
    await waitFor(() => {
      expect(api.meetings.records.get('a')?.folderId).toBeNull();
    });
  });

  it('dropping where the meetings already are does nothing', async () => {
    const { api } = await mount(({ meetings, folders }) => {
      seedDrag({ meetings, folders } as never);
      const record = meetings.records.get('a');
      if (record) meetings.records.set('a', { ...record, folderId: UNI });
    });
    dragTo(rowOf(/First/), tree(/Universidad/));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.calls.some((c) => c.name === 'library.moveMeetings')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('holding over a closed folder opens it, and leaving in time does not', async () => {
    await mount(seedDrag);
    const transfer = dataTransfer();
    fireEvent.dragStart(rowOf(/First/), { dataTransfer: transfer });
    fireEvent.dragOver(tree(/Universidad/), { dataTransfer: transfer });
    fireEvent.dragLeave(tree(/Universidad/), { dataTransfer: transfer });
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(tree(/Universidad/)).toHaveAttribute('aria-expanded', 'false');
    fireEvent.dragOver(tree(/Universidad/), { dataTransfer: transfer });
    await waitFor(
      () => {
        expect(tree(/Universidad/)).toHaveAttribute('aria-expanded', 'true');
      },
      { timeout: 1000 },
    );
    expect(tree(/Calculo/)).toBeInTheDocument();
    fireEvent.dragEnd(rowOf(/First/), { dataTransfer: transfer });
  });

  it('Undo puts each meeting back where it was', async () => {
    const { api, user } = await mount(({ meetings, folders }) => {
      seedDrag({ meetings, folders } as never);
      const record = meetings.records.get('b');
      if (record) meetings.records.set('b', { ...record, folderId: CALC });
    });
    await user.click(within(rowOf(/First/)).getByRole('checkbox'));
    await user.click(within(rowOf(/Second/)).getByRole('checkbox'));
    dragTo(rowOf(/First/), tree(/Universidad/));
    expect(await screen.findByText('Moved 2 meetings to Universidad.')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.meetings.records.get('b')?.folderId).toBe(UNI);
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.meetings.records.get('a')?.folderId).toBeNull();
    });
    await waitFor(() => {
      expect(api.meetings.records.get('b')?.folderId).toBe(CALC);
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('Undo is also there after the Move dialog, for one meeting and for several', async () => {
    const { api, user } = await mount(seedDrag);
    await user.click(within(rowOf(/First/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move' }));
    let dialog = await screen.findByRole('dialog', { name: 'Move meeting' });
    await user.click(within(dialog).getByRole('radio', { name: 'Universidad' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await screen.findByText('Moved "First" to Universidad.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.meetings.records.get('a')?.folderId).toBeNull();
    });

    await user.click(
      await within(await screen.findByRole('row', { name: /Second/ })).findByRole('checkbox'),
    );
    await user.click(within(rowOf(/Third/)).getByRole('checkbox'));
    await user.click(
      within(screen.getByRole('toolbar', { name: 'Checked meetings' })).getByRole('button', {
        name: 'Move',
      }),
    );
    dialog = await screen.findByRole('dialog', { name: 'Move 2 meetings' });
    await user.click(within(dialog).getByRole('radio', { name: 'Universidad' }));
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await screen.findByText('Moved 2 meetings to Universidad.')).toBeInTheDocument();
  });

  it('a meeting that cannot move is reported and only the moved ones are offered back', async () => {
    const { api, user } = await mount(seedDrag);
    api.busy.register({ isBusy: (id) => id === 'a' });
    await user.click(within(rowOf(/First/)).getByRole('checkbox'));
    await user.click(within(rowOf(/Second/)).getByRole('checkbox'));
    dragTo(rowOf(/First/), tree(/Universidad/));
    expect(await screen.findByText('1 of 2 meetings could not be moved.')).toBeInTheDocument();
    expect(await screen.findByText('Moved "Second" to Universidad.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.meetings.records.get('b')?.folderId).toBeNull();
    });
    expect(api.calls.filter((c) => c.name === 'library.moveMeetings').map((c) => c.input)).toEqual([
      { meetingIds: ['a', 'b'], folderId: UNI },
      { meetingIds: ['b'], folderId: null },
    ]);
  });

  it('the Undo offer can be closed and goes away by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = await mount(seedDrag);
      dragTo(rowOf(/First/), tree(/Universidad/));
      const offer = await screen.findByRole('button', { name: 'Undo' });
      expect(offer).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
      dragTo(rowOf(/Second/), tree(/Universidad/));
      await screen.findByRole('button', { name: 'Undo' });
      await user.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
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
