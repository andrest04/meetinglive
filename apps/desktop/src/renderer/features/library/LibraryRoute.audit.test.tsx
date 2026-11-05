// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { formatMeetingDate } from './format';
import {
  LibraryScreen,
  Providers,
  folderRecord,
  installFakeApi,
  meetingRecord,
} from './library-test-kit';

beforeAll(() => {
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
    get: () => 900,
  });
});

const UNI = '11111111-1111-4111-8111-111111111111';
const CALC = '22222222-2222-4222-8222-222222222222';

type Api = ReturnType<typeof installFakeApi>;

async function mount(
  setup?: (api: Api) => void,
  options: { startupError?: string | null; waitForLoad?: boolean } = {},
) {
  const api = installFakeApi(options);
  setup?.(api);
  const user = userEvent.setup();
  const { unmount } = render(
    <Providers>
      <LibraryScreen />
    </Providers>,
  );
  if (options.waitForLoad !== false) {
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
    });
  }
  return { api, user, unmount };
}

const seed = ({ meetings, folders }: Api): void => {
  folders.folders = [
    folderRecord(UNI, 'Universidad', null, { note: 'Fall term', colorKey: 'teal' }),
    folderRecord(CALC, 'Calculo', UNI),
  ];
  meetings.records.set('a', meetingRecord('a', 'Standup', '2026-09-01T09:00:00.0000000+00:00'));
  meetings.records.set(
    'c',
    meetingRecord('c', 'Review', '2026-09-02T09:00:00.0000000+00:00', { folderId: 'gone' }),
  );
};

const publishes = (api: Api) => api.actions.filter((a) => a.type === 'publishSelectedFolder');

function rowOf(name: RegExp): HTMLElement {
  const row = screen.getByRole('button', { name }).closest('li');
  if (!row) throw new Error('no row');
  return row;
}

describe('selection and the workspace', () => {
  it('item 87: selecting a folder publishes its id, and the stored selection is restored on mount', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await waitFor(() => {
      expect(publishes(api)).toContainEqual({ type: 'publishSelectedFolder', folderId: UNI });
    });
    expect(api.workspace.state.selectedFolderId).toBe(UNI);
  });

  it('item 87: the selection kept by the workspace is restored on mount', async () => {
    await mount((a) => {
      seed(a);
      a.workspace.publishSelectedFolder(CALC);
    });
    expect(screen.getByRole('treeitem', { name: /Calculo/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('item 85: choosing the node that is already selected does nothing', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await waitFor(() => {
      expect(publishes(api)).toContainEqual({ type: 'publishSelectedFolder', folderId: UNI });
    });
    const published = publishes(api).length;
    await user.type(screen.getByRole('textbox', { name: 'Folder notes' }), 'x');
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    expect(publishes(api)).toHaveLength(published);
    expect(screen.getByRole('textbox', { name: 'Folder notes' })).toHaveValue('Fall termx');
  });

  it('item 84 and B14: a folder the user opened stays open after a reload', async () => {
    const { api, user } = await mount(seed);
    const item = screen.getByRole('treeitem', { name: /Universidad/ });
    expect(item).toHaveAttribute('aria-expanded', 'false');
    item.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: /Universidad/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const loads = api.calls.filter((c) => c.name === 'library.load').length;
    api.emit('library.changed', { reason: 'folder' });
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'library.load').length).toBeGreaterThan(loads);
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole('treeitem', { name: /Universidad/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('loading', () => {
  it('item 96: the skeleton shows and the body is hidden during the first load', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mount(
      (a) => {
        seed(a);
        const load = a.service.load.bind(a.service);
        vi.spyOn(a.service, 'load').mockImplementation(async () => {
          await gate;
          return load();
        });
      },
      { waitForLoad: false },
    );
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText('Standup')).not.toBeInTheDocument();
    release();
    expect(await screen.findByText('Standup')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  });

  it('item 87: the stored selection still applies when a refresh replaces the first load', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = await mount(
      (a) => {
        seed(a);
        a.workspace.publishSelectedFolder(CALC);
        const load = a.service.load.bind(a.service);
        let first = true;
        vi.spyOn(a.service, 'load').mockImplementation(async () => {
          if (first) {
            first = false;
            await gate;
          }
          return load();
        });
      },
      { waitForLoad: false },
    );
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'library.load')).toHaveLength(1);
    });
    api.emit('library.changed', { reason: 'folder' });
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /Calculo/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    release();
  });

  it('item 96: the skeleton clears even when the stored selection cannot be read', async () => {
    await mount((a) => {
      seed(a);
      const real = a.workspace.state;
      let failed = false;
      Object.defineProperty(a.workspace, 'state', {
        get: () => {
          if (failed) return real;
          failed = true;
          throw new Error('no state');
        },
      });
    });
    expect(await screen.findByText('Standup')).toBeInTheDocument();
  });
});

describe('the folder note', () => {
  it('item 97: a typed note is saved when the page unmounts', async () => {
    const { api, user, unmount } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.type(screen.getByRole('textbox', { name: 'Folder notes' }), ' typed');
    unmount();
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.id === UNI)?.note).toBe('Fall term typed');
    });
  });

  it('B16: a character typed while the reload after an autosave is in flight is kept', async () => {
    const { api, user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    let release: () => void = () => undefined;
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
    // The autosave stores "A", main broadcasts a change and the reload now waits on the gate.
    await waitFor(
      () => {
        expect(api.calls.filter((c) => c.name === 'library.setFolderNote')).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    await user.type(note, 'B');
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('textbox', { name: 'Folder notes' })).toHaveValue('Fall termAB');
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(async () => {
      expect((await api.folders.getAll()).find((f) => f.id === UNI)?.note).toBe('Fall termAB');
    });
  });
});

describe('the meeting row', () => {
  it('item 114: right click and the more button both open Open summary, Move, Delete in that order', async () => {
    const { user } = await mount(seed);
    const names = (): (string | null)[] =>
      screen.getAllByRole('menuitem').map((item) => item.textContent);
    await user.pointer({
      keys: '[MouseRight]',
      target: within(rowOf(/Standup/)).getByRole('button', { name: /Standup/ }),
    });
    await screen.findByRole('menuitem', { name: 'Move' });
    expect(names()).toEqual(['Open summary', 'Move', 'Delete']);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });
    await user.click(within(rowOf(/Standup/)).getByRole('button', { name: 'More actions' }));
    await screen.findByRole('menuitem', { name: 'Move' });
    expect(names()).toEqual(['Open summary', 'Move', 'Delete']);
  });

  it('item 111: the row shows the local short date and time of the meeting', async () => {
    await mount(seed);
    const expected = formatMeetingDate('2026-09-01T09:00:00.0000000+00:00', 'en');
    expect(expected).not.toBe('');
    expect(within(rowOf(/Standup/)).getByText(expected)).toBeInTheDocument();
  });

  it('item 115: Move preselects Inbox for a dangling folder id and the real folder otherwise', async () => {
    const { user } = await mount(seed);
    await user.click(within(rowOf(/Review/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move' }));
    let dialog = await screen.findByRole('dialog', { name: 'Move meeting' });
    let options = within(dialog).getAllByRole('radio');
    expect(options.map((o) => o.getAttribute('aria-checked') === 'true')).toEqual([
      true,
      false,
      false,
    ]);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Move meeting' })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    await user.click(within(rowOf(/Standup/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move' }));
    dialog = await screen.findByRole('dialog', { name: 'Move meeting' });
    const third = within(dialog).getAllByRole('radio')[2];
    if (!third) throw new Error('no destination');
    await user.click(third);
    await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Move meeting' })).not.toBeInTheDocument();
    });
    screen.getByRole('treeitem', { name: /Universidad/ }).focus();
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('treeitem', { name: /Calculo/ }));
    await user.click(within(rowOf(/Standup/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move' }));
    dialog = await screen.findByRole('dialog', { name: 'Move meeting' });
    options = within(dialog).getAllByRole('radio');
    expect(options.map((o) => o.getAttribute('aria-checked') === 'true')).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe('status messages and startup', () => {
  it('item 117: a busy meeting, then a failed save, while moving each show a message', async () => {
    const { api, user } = await mount(seed);
    const move = async (name: RegExp): Promise<void> => {
      await user.click(within(rowOf(name)).getByRole('button', { name: 'More actions' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Move' }));
      const dialog = await screen.findByRole('dialog', { name: 'Move meeting' });
      const options = within(dialog).getAllByRole('radio');
      const target = options[1];
      if (!target) throw new Error('no destination');
      await user.click(target);
      await user.click(within(dialog).getByRole('button', { name: 'Move' }));
    };
    api.busy.register({ isBusy: (id) => id === 'a' });
    await move(/Standup/);
    expect(
      await screen.findByText(
        'This meeting is still being recorded or processed. Try again when it finishes.',
      ),
    ).toBeInTheDocument();
    expect(api.meetings.records.get('a')?.folderId).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close' }));

    vi.spyOn(api.meetings, 'save').mockRejectedValue(new Error('disk full'));
    await move(/Review/);
    expect(await screen.findByText(/The meeting was not moved: .*disk full/)).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('B13: a failed create, rename or personality save shows the folder message', async () => {
    const { api, user } = await mount(seed);
    vi.spyOn(api.folders, 'save').mockRejectedValue(new Error('disk full'));

    await user.click(screen.getByRole('button', { name: 'New folder' }));
    let dialog = await screen.findByRole('dialog', { name: 'New folder' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Trabajo{Enter}');
    expect(await screen.findByText(/The folder was not changed: .*disk full/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/The folder was not changed/)).not.toBeInTheDocument();

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('treeitem', { name: /Universidad/ }),
    });
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    dialog = await screen.findByRole('dialog', { name: 'Rename folder' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Estudios{Enter}');
    expect(await screen.findByText(/The folder was not changed: .*disk full/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect((await api.folders.getAll()).find((f) => f.id === UNI)?.name).toBe('Universidad');

    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.click(screen.getByRole('button', { name: 'Folder actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Personality' }));
    dialog = await screen.findByRole('dialog', { name: 'Folder personality' });
    await user.click(within(dialog).getByRole('radio', { name: 'purple' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/The folder was not changed: .*disk full/)).toBeInTheDocument();
    expect((await api.folders.getAll()).find((f) => f.id === UNI)?.colorKey).toBe('teal');
  });

  it('item 105: the personality preview follows the picked color and icon', async () => {
    const { user } = await mount(seed);
    await user.click(screen.getByRole('treeitem', { name: /Universidad/ }));
    await user.click(screen.getByRole('button', { name: 'Folder actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Personality' }));
    const dialog = await screen.findByRole('dialog', { name: 'Folder personality' });
    const dot = (): string | undefined =>
      dialog.querySelector<HTMLElement>('span.rounded-full')?.style.backgroundColor;
    const glyph = (): string => dialog.querySelector('.h-9.rounded-control svg')?.innerHTML ?? '';
    const colorBefore = dot();
    const iconBefore = glyph();
    expect(colorBefore).toBeTruthy();
    await user.click(within(dialog).getByRole('radio', { name: 'purple' }));
    await user.click(within(dialog).getByRole('radio', { name: 'book' }));
    expect(dot()).toBeTruthy();
    expect(dot()).not.toBe(colorBefore);
    expect(glyph()).not.toBe(iconBefore);
  });

  it('item 123: the status notice has a Close that clears the message', async () => {
    const { api, user } = await mount(seed);
    api.meetings.lockedIds.add('c');
    await user.click(within(rowOf(/Review/)).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this meeting?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/The meeting was not deleted/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/The meeting was not deleted/)).not.toBeInTheDocument();
  });

  it('item 141: a startup migration error is shown in the page', async () => {
    await mount(seed, { startupError: 'meetings.json is damaged' });
    expect(
      await screen.findByText(/could not be moved yet\. meetings\.json is damaged/),
    ).toBeInTheDocument();
  });
});
