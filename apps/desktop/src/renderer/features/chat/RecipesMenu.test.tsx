// @vitest-environment jsdom
import { recipesForScope } from '@vozella/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { Composer } from './Composer';

const names = (key: string): string => key;

beforeAll(() => {
  // jsdom has no layout, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function Harness({
  kind = 'Meeting',
  initial = '',
  onSend = () => undefined,
}: {
  kind?: 'Meeting' | 'Folder';
  initial?: string;
  onSend?: (draft: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const recipes = recipesForScope(kind, names);
  return (
    <Providers locale="en">
      <Composer
        draft={draft}
        onDraftChange={setDraft}
        onSend={() => {
          onSend(draft);
        }}
        onStop={() => undefined}
        isSending={false}
        recipes={recipes}
      />
    </Providers>
  );
}

const field = () => screen.getByTestId<HTMLTextAreaElement>('TxtMeetingChat');
const button = () => screen.getByTestId('BtnMeetingChatRecipes');
const list = () => screen.getByTestId('ListMeetingChatRecipes');
const items = () => within(list()).getAllByRole('option');
const item = (index: number): HTMLElement => {
  const found = items()[index];
  if (!found) throw new Error(`no recipe row ${String(index)}`);
  return found;
};
const recipe = (index: number, kind: 'Meeting' | 'Folder' = 'Meeting') => {
  const found = recipesForScope(kind, names)[index];
  if (!found) throw new Error(`no recipe ${String(index)}`);
  return found;
};

describe('Recipes button (items 108, 111)', () => {
  it('opens the full list of nine for a meeting and three for a folder', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness kind="Meeting" />);
    expect(button()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    await user.click(button());
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    expect(items()).toHaveLength(9);
    unmount();
    render(<Harness kind="Folder" />);
    await user.click(button());
    expect(items()).toHaveLength(3);
  });

  it('shows the name over the prompt and toggles closed on a second click', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(button());
    expect(item(0)).toHaveTextContent(recipe(0).prompt);
    expect(list()).toHaveStyle({ maxHeight: '240px' });
    await user.click(button());
    expect(screen.queryByTestId('ListMeetingChatRecipes')).toBeNull();
  });

  it('clicking an item fills the draft without sending, closes, focuses and puts the caret at the end', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await user.click(button());
    const chosen = recipe(1);
    await user.click(item(1));
    expect(field()).toHaveValue(chosen.prompt);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ListMeetingChatRecipes')).toBeNull();
    expect(field()).toHaveFocus();
    expect(field().selectionStart).toBe(chosen.prompt.length);
    expect(field().selectionEnd).toBe(chosen.prompt.length);
  });

  it('has no delete icon and no New recipe button (user recipes dropped)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(button());
    expect(
      within(screen.getByTestId('PopupMeetingChatRecipes')).queryAllByRole('button'),
    ).toHaveLength(0);
  });
});

describe('slash filter (items 110, 111, S7)', () => {
  it('opens on a leading slash and lists everything for an empty query', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '/');
    expect(items()).toHaveLength(9);
  });

  it('filters by a case-insensitive substring of name or prompt', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '/ACT');
    const shown = items().map((o) => o.textContent);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(9);
    for (const text of shown) expect(text.toLowerCase()).toContain('act');
    await user.type(field(), 'zzzz');
    expect(screen.getByText('No recipes for this scope.')).toBeInTheDocument();
  });

  it('keeps focus in the composer and hides when the slash goes away', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '/ac');
    expect(field()).toHaveFocus();
    await user.type(field(), '{Backspace}{Backspace}{Backspace}');
    expect(screen.queryByTestId('ListMeetingChatRecipes')).toBeNull();
    await user.type(field(), 'hi');
    expect(screen.queryByTestId('ListMeetingChatRecipes')).toBeNull();
  });

  it('a pick from the slash list does not reopen it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '/');
    await user.click(item(0));
    expect(field()).toHaveValue(recipe(0).prompt);
    expect(screen.queryByTestId('ListMeetingChatRecipes')).toBeNull();
  });

  it('Enter sends until ArrowDown highlights a row; then arrows and Enter pick, Escape closes', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await user.type(field(), '/');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(field()).toHaveFocus();
    expect(items()[1]).toHaveAttribute('aria-selected', 'true');
    expect(field()).toHaveAttribute('aria-activedescendant', item(1).id);
    await user.keyboard('{ArrowUp}');
    expect(items()[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(field()).toHaveValue(recipe(0).prompt);

    await user.clear(field());
    await user.type(field(), '/');
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('ListMeetingChatRecipes')).toBeNull();
    expect(field()).toHaveValue('/');
  });

  it('sending a draft that starts with a slash sends it literally', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    await user.type(field(), '/nothing-matches');
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith('/nothing-matches');
  });
});
