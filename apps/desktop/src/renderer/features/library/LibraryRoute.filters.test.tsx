// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectLibrary, useLibraryStore } from './library-store';
import { LibraryRoute } from './LibraryRoute';
import {
  LibraryScreen,
  Providers,
  folderRecord,
  installFakeApi,
  meetingRecord,
  stubLayout,
} from './library-test-kit';

const FOLDER = '11111111-1111-4111-8111-111111111111';

const pad = (value: number): string => String(value).padStart(2, '0');

/** A stored date some local days back at noon, so the last 7 days are the real ones. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T12:00:00.0000000${zone}`
  );
}

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
  stubLayout();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 900,
  });
});

type Api = ReturnType<typeof installFakeApi>;

/** Five meetings: two recent with a summary or a transcript, three older, one in a folder. */
const seed = ({ meetings, folders }: Api): void => {
  folders.folders = [folderRecord(FOLDER, 'Clients')];
  const add = (id: string, title: string, days: number, extra = {}): void => {
    meetings.records.set(id, meetingRecord(id, title, daysAgo(days), extra));
  };
  add('recent-summary', 'Recent with summary', 1, { summary: 'Agreed the plan' });
  add('recent-transcript', 'Recent with transcript', 2, { transcript: 'Talked about pelicans' });
  add('older-summary', 'Older with summary', 20, { summary: 'Pelicans again' });
  add('old-bare', 'Old and bare', 60);
  add('folder-recent', 'Folder recent', 3, { folderId: FOLDER, summary: 'In a folder' });
};

async function mount() {
  const api = installFakeApi();
  seed(api);
  const user = userEvent.setup();
  render(
    <Providers>
      <LibraryScreen />
    </Providers>,
  );
  await screen.findByRole('row', { name: /Recent with summary/ });
  return { api, user };
}

const filterButton = (): HTMLElement => screen.getByRole('button', { name: /^Filters/ });
const titles = (): readonly (string | null)[] =>
  screen.queryAllByRole('row').flatMap((row) => {
    if (row.dataset.rowId === undefined) return [];
    return [row.getAttribute('data-row-id')];
  });

async function choose(user: ReturnType<typeof userEvent.setup>, ...names: readonly string[]) {
  await user.click(filterButton());
  const dialog = await screen.findByRole('dialog', { name: 'Filters' });
  for (const name of names) await user.click(within(dialog).getByRole('radio', { name }));
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
  });
}

describe('the filter button', () => {
  it('names itself, opens a dialog with both groups, and marks nothing at first', async () => {
    const { user } = await mount();
    expect(filterButton()).toHaveAccessibleName('Filters');
    expect(screen.queryByTestId('library-filter-mark')).not.toBeInTheDocument();
    await user.click(filterButton());
    const dialog = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(dialog).getByRole('radiogroup', { name: 'Date' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radiogroup', { name: 'Status' })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Any' })).toBeChecked();
  });

  it('shows and says how many filters are on', async () => {
    const { user } = await mount();
    await choose(user, 'Last 7 days', 'With summary');
    expect(filterButton()).toHaveAccessibleName('Filters active: 2');
    expect(screen.getByTestId('library-filter-mark')).toBeInTheDocument();
  });

  it('Escape closes the dialog, gives the focus back and leaves checks and search alone', async () => {
    const { user } = await mount();
    await user.type(screen.getByRole('searchbox'), 'Recent');
    await user.click(
      within(screen.getByRole('row', { name: /Recent with summary/ })).getByRole('checkbox'),
    );
    expect(screen.getByRole('toolbar', { name: 'Checked meetings' })).toBeInTheDocument();

    filterButton().focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Filters' });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(filterButton()).toHaveFocus();
    });
    expect(screen.getByRole('toolbar', { name: 'Checked meetings' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('Recent');
  });

  it('applies a custom range from the two date fields, both ends inclusive', async () => {
    const { user } = await mount();
    await user.click(filterButton());
    const dialog = await screen.findByRole('dialog', { name: 'Filters' });
    expect(within(dialog).queryByLabelText('From')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Custom range' }));
    // Nothing is filtered until a day is given.
    expect(filterButton()).toHaveAccessibleName('Filters');
    expect(titles()).toHaveLength(5);

    const day = daysAgo(2).slice(0, 10);
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: day } });
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: day } });
    await waitFor(() => {
      expect(titles()).toEqual(['recent-transcript']);
    });
    expect(filterButton()).toHaveAccessibleName('Filters active: 1');
  });
});

describe('the filtered list', () => {
  it('filters by date and by status, and counts filtered of total', async () => {
    const { user } = await mount();
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^5$/);
    await choose(user, 'Last 7 days');
    expect(titles()).toEqual(['recent-summary', 'recent-transcript', 'folder-recent']);
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^3 of 5$/);

    await choose(user, 'With summary');
    expect(titles()).toEqual(['recent-summary', 'folder-recent']);
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^2 of 5$/);
    expect(screen.getByRole('status', { name: 'Filter results' })).toHaveTextContent(
      'Showing 2 of 5 meetings',
    );
  });

  it('combines with the selected view and keeps the filter across views', async () => {
    const { user } = await mount();
    await choose(user, 'Last 7 days');
    await user.click(screen.getByRole('treeitem', { name: /Inbox/ }));
    expect(titles()).toEqual(['recent-summary', 'recent-transcript']);
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^2 of 4$/);
    await user.click(screen.getByRole('treeitem', { name: /Clients/ }));
    expect(titles()).toEqual(['folder-recent']);
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^1 of 1$/);
    expect(screen.getByRole('button', { name: 'Remove filter: Last 7 days' })).toBeInTheDocument();
  });

  it('filters what the title search and the search inside meetings found', async () => {
    const { user } = await mount();
    await choose(user, 'Last 7 days');
    // "pelicans" is only inside: one recent transcript and one older summary.
    await user.type(screen.getByRole('searchbox'), 'pelicans');
    await waitFor(() => {
      expect(titles()).toEqual(['recent-transcript']);
    });
    expect(await screen.findByText('Matches: 1')).toBeInTheDocument();
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^1 of 5$/);

    // A title match goes through the same filter.
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'bare');
    await waitFor(() => {
      expect(screen.getByText('No meetings match these filters.')).toBeInTheDocument();
    });
  });

  it('moves the cursor to a row still listed, and Ctrl+A takes only the filtered rows', async () => {
    const { user } = await mount();
    await user.click(screen.getByRole('row', { name: /Old and bare/ }));
    await choose(user, 'Last 7 days');
    await waitFor(() => {
      expect(titles()).not.toContain('old-bare');
    });
    expect(titles()).toContain(useLibraryStore.getState().cursorId);

    await user.click(screen.getByRole('row', { name: /Recent with transcript/ }));
    await user.keyboard('{Control>}a{/Control}');
    expect(
      within(screen.getByRole('toolbar', { name: 'Checked meetings' })).getByText('Checked: 3'),
    ).toBeInTheDocument();
  });

  it('groups the days of the filtered rows only', async () => {
    const { user } = await mount();
    const headers = (): number =>
      screen.getAllByRole('rowheader').filter((cell) => cell.closest('[role="row"]')).length;
    expect(headers()).toBe(5);
    await choose(user, 'Without summary');
    expect(titles()).toEqual(['recent-transcript', 'old-bare']);
    expect(headers()).toBe(2);
  });

  it('clears the checks when a filter changes', async () => {
    const { user } = await mount();
    await user.click(
      within(screen.getByRole('row', { name: /Recent with summary/ })).getByRole('checkbox'),
    );
    expect(screen.getByRole('toolbar', { name: 'Checked meetings' })).toBeInTheDocument();
    await choose(user, 'Last 30 days');
    expect(screen.queryByRole('toolbar', { name: 'Checked meetings' })).not.toBeInTheDocument();
  });
});

describe('chips', () => {
  it('shows one for each filter, and a removed one goes with the focus on the button', async () => {
    const { user } = await mount();
    await choose(user, 'Last 7 days', 'Without transcript');
    const group = screen.getByRole('group', { name: 'Active filters' });
    expect(within(group).getByText('Last 7 days')).toBeInTheDocument();
    expect(within(group).getByText('Without transcript')).toBeInTheDocument();

    await user.click(within(group).getByRole('button', { name: 'Remove filter: Last 7 days' }));
    expect(within(group).queryByText('Last 7 days')).not.toBeInTheDocument();
    expect(filterButton()).toHaveFocus();
    expect(titles()).toEqual(['recent-summary', 'folder-recent', 'older-summary', 'old-bare']);
  });

  it('Clear filters takes them all and says nothing is left to remove', async () => {
    const { user } = await mount();
    await choose(user, 'Last 7 days', 'With summary');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByRole('group', { name: 'Active filters' })).not.toBeInTheDocument();
    expect(filterButton()).toHaveFocus();
    expect(filterButton()).toHaveAccessibleName('Filters');
    expect(titles()).toHaveLength(5);
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^5$/);
  });

  it('names a custom range by the ends it has', async () => {
    const { user } = await mount();
    await user.click(filterButton());
    const dialog = await screen.findByRole('dialog', { name: 'Filters' });
    await user.click(within(dialog).getByRole('radio', { name: 'Custom range' }));
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-09-05' } });
    expect(await screen.findByRole('button', { name: /^Remove filter: From / })).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-09-10' } });
    expect(await screen.findByRole('button', { name: /^Remove filter: .+ to .+/ })).toBeVisible();
    fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '' } });
    expect(await screen.findByRole('button', { name: /^Remove filter: Until / })).toBeVisible();
  });
});

describe('no match', () => {
  it('says so in its own words and offers to clear', async () => {
    const { user } = await mount();
    await choose(user, 'Last 7 days', 'Without summary');
    await user.click(screen.getByRole('treeitem', { name: /Clients/ }));
    expect(screen.getByText('No meetings match these filters.')).toBeInTheDocument();
    expect(screen.queryByText('This folder is empty.')).not.toBeInTheDocument();
    expect(screen.queryByText('No meetings match your search.')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-view-count')).toHaveTextContent(/^0 of 1$/);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(titles()).toEqual(['folder-recent']);
    expect(filterButton()).toHaveFocus();
  });

  it('keeps the search line when the search itself found nothing', async () => {
    const { user } = await mount();
    await choose(user, 'Last 7 days');
    await user.type(screen.getByRole('searchbox'), 'zzzz');
    expect(await screen.findByText('No meetings match your search.')).toBeInTheDocument();
    expect(screen.queryByText('No meetings match these filters.')).not.toBeInTheDocument();
  });

  it('keeps the empty folder line when the folder has nothing to filter', async () => {
    const api = installFakeApi();
    seed(api);
    api.meetings.records.delete('folder-recent');
    const user = userEvent.setup();
    render(
      <Providers>
        <LibraryScreen />
      </Providers>,
    );
    await screen.findByRole('row', { name: /Recent with summary/ });
    await choose(user, 'Last 7 days');
    await user.click(screen.getByRole('treeitem', { name: /Clients/ }));
    expect(screen.getByText('This folder is empty.')).toBeInTheDocument();
    expect(screen.queryByText('No meetings match these filters.')).not.toBeInTheDocument();
  });
});

describe('how long they last', () => {
  afterEach(() => {
    useLibraryStore.setState({ filters: { date: { kind: 'any' }, status: 'any' } });
  });

  it('survive leaving the route and coming back, and end when the library disconnects', async () => {
    const api = installFakeApi();
    seed(api);
    const off = connectLibrary();
    const user = userEvent.setup();
    const route = render(
      <Providers>
        <LibraryRoute />
      </Providers>,
    );
    await screen.findByRole('row', { name: /Recent with summary/ });
    await choose(user, 'Without transcript');
    route.unmount();

    render(
      <Providers>
        <LibraryRoute />
      </Providers>,
    );
    await screen.findByRole('row', { name: /Recent with summary/ });
    expect(filterButton()).toHaveAccessibleName('Filters active: 1');
    expect(titles()).not.toContain('recent-transcript');

    off();
    expect(useLibraryStore.getState().filters.status).toBe('any');
  });

  it('nothing about them is written anywhere', async () => {
    const { api, user } = await mount();
    const before = api.calls.length;
    await choose(user, 'Last 7 days');
    const written = api.calls.slice(before).map((call) => call.name);
    expect(written.filter((name) => name !== 'library.getMeeting')).toEqual([]);
  });
});
