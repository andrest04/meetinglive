// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LibraryRoute } from './LibraryRoute';
import { Providers, folderRecord, installFakeApi, meetingRecord } from './library-test-kit';

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
  const row = screen.getByRole('button', { name }).closest('li');
  if (!row) throw new Error('no row');
  return row;
}
function rowAt(rows: readonly HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (!row) throw new Error('no row ' + String(index));
  return row;
}
const optionAt = rowAt;

const UNI = '11111111-1111-4111-8111-111111111111';
const CALC = '22222222-2222-4222-8222-222222222222';

async function mount(setup?: (api: ReturnType<typeof installFakeApi>) => void) {
  const api = installFakeApi();
  setup?.(api);
  const user = userEvent.setup();
  render(
    <Providers>
      <LibraryRoute />
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
    await mount(seed);
    const list = screen.getByRole('list', { name: 'Library' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getAllByRole('button')[0]?.textContent)).toEqual([
      expect.stringContaining('Review'),
      expect.stringContaining('Standup'),
    ]);
    expect(within(rowAt(rows, 1)).getByText('Ship the release')).toBeInTheDocument();
    expect(within(rowAt(rows, 0)).getByText('No content yet')).toBeInTheDocument();
  });

  it('filters by title and keeps the query when the folder changes', async () => {
    const { user } = await mount(seed);
    await user.type(screen.getByRole('searchbox'), 'stand');
    expect(screen.getByText('Standup')).toBeInTheDocument();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(screen.getByRole('searchbox')).toHaveValue('stand');
    expect(screen.getByText('No meetings match your search.')).toBeInTheDocument();
  });

  it('opens a meeting on the transcript and the summary through the workspace', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('button', { name: /Standup/ }));
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
  it('shows the tree with Inbox first and expands only what leads to the selection', async () => {
    await mount(seed);
    const items = screen.getAllByRole('treeitem');
    expect(items.map((item) => item.textContent)).toEqual(['Inbox', 'Universidad']);
    expect(items[1]).toHaveAttribute('aria-expanded', 'false');
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
    expect(screen.getByText('Planning')).toBeInTheDocument();
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

  it('has no folder menu on Inbox', async () => {
    const { user } = await mount(seed);
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: /Inbox/ }),
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
      expect(screen.queryByText('Standup')).not.toBeInTheDocument();
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
      within(dialog).getByText('This permanently deletes "Review" and its recording.'),
    ).toBeInTheDocument();
    // The safe choice has the focus.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(api.meetings.records.has('c')).toBe(false);
    });
    await waitFor(() => {
      expect(screen.queryByText('Review')).not.toBeInTheDocument();
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
    expect(screen.getByText('Review')).toBeInTheDocument();
  });
});

describe('narrow layout', () => {
  it('keeps the folder pane closed until asked, and closes it after a choice', async () => {
    pageWidth = 480;
    const { user } = await mount(seed);
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Folder' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('tree', { name: 'Folders' })).toBeInTheDocument();
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('shows no toggle when the page is wide', async () => {
    await mount(seed);
    expect(screen.queryByRole('button', { name: 'Folder' })).not.toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });
});
