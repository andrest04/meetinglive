// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notepad } from './Notepad';

type Props = Parameters<typeof Notepad>[0];

// jsdom has no layout; ProseMirror asks for rectangles when it moves the caret.
const noRects: DOMRectList = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: () => [][Symbol.iterator](),
};
Range.prototype.getClientRects = () => noRects;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.getClientRects = () => noRects;
document.elementFromPoint = () => null;

/** Focuses the editor with the caret at the end, as a click below the text does. */
async function focusEnd(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const el = await screen.findByRole('textbox', { name: 'Notes' });
  await user.click(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

function setup(props: Partial<Props> = {}) {
  const onChange = vi.fn();
  const view = render(
    <Notepad
      value=""
      onChange={onChange}
      label="Notes"
      placeholder="Optional — write in your own words"
      {...props}
    />,
  );
  const rerender = (next: Partial<Props>): void => {
    view.rerender(
      <Notepad
        value=""
        onChange={onChange}
        label="Notes"
        placeholder="Optional — write in your own words"
        {...props}
        {...next}
      />,
    );
  };
  return { onChange, rerender, unmount: view.unmount };
}

const box = (): HTMLElement => screen.getByRole('textbox', { name: 'Notes' });

describe('Notepad', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('is a labeled textbox with the automation id and the placeholder', async () => {
    setup();
    const el = await screen.findByRole('textbox', { name: 'Notes' });
    expect(el).toHaveAttribute('id', 'TxtRecordingNotes');
    expect(el).toHaveAttribute('aria-multiline', 'true');
    expect(el.querySelector('p')).toHaveAttribute(
      'data-placeholder',
      'Optional — write in your own words',
    );
  });

  it('pushes typed text as Markdown after the debounce, once', async () => {
    const { onChange } = setup({ debounceMs: 60 });
    const user = userEvent.setup();
    await focusEnd(user);
    await user.keyboard('hello **bold**');
    expect(onChange).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenLastCalledWith('hello **bold**');
  });

  it('sends only the last text for a burst of keystrokes', async () => {
    const { onChange } = setup({ debounceMs: 80 });
    const user = userEvent.setup({ delay: 5 });
    await focusEnd(user);
    await user.keyboard('abcdef');
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('abcdef');
  });

  it('flushes at once on blur', async () => {
    const { onChange } = setup({ debounceMs: 60_000 });
    const user = userEvent.setup();
    await focusEnd(user);
    await user.keyboard('call Ana');
    expect(onChange).not.toHaveBeenCalled();
    await user.tab();
    expect(onChange).toHaveBeenCalledWith('call Ana');
  });

  it('flushes pending text when it unmounts', async () => {
    const { onChange, unmount } = setup({ debounceMs: 60_000 });
    const user = userEvent.setup();
    await focusEnd(user);
    await user.keyboard('last words');
    unmount();
    expect(onChange).toHaveBeenCalledWith('last words');
  });

  it('does not push when nothing was typed', async () => {
    const { onChange, unmount } = setup({ value: 'from main' });
    await screen.findByRole('textbox', { name: 'Notes' });
    unmount();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the text main holds and loads plain text unchanged', async () => {
    setup({ value: 'Agenda\nBudget' });
    expect(await screen.findByText(/Agenda/)).toBeInTheDocument();
    expect(box().textContent).toContain('Budget');
  });

  it('pushes an empty string when the text is cleared', async () => {
    const { onChange } = setup({ value: 'gone soon', debounceMs: 20 });
    const user = userEvent.setup();
    await focusEnd(user);
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith('');
    });
  });

  it('re-seeds from main while the editor is not focused (the next take starts empty)', async () => {
    const { rerender } = setup({ value: 'previous take' });
    await screen.findByText('previous take');
    rerender({ value: '' });
    await vi.waitFor(() => {
      expect(box().textContent).toBe('');
    });
  });

  it('never replaces what the user is typing', async () => {
    const { rerender } = setup({ value: 'mine', debounceMs: 60_000 });
    const user = userEvent.setup();
    await focusEnd(user);
    await user.keyboard(' plus');
    act(() => {
      rerender({ value: 'something else from main' });
    });
    expect(box().textContent).toBe('mine plus');
  });

  it('does not rewrite the editor with its own echo', async () => {
    const { rerender } = setup({ value: '', debounceMs: 10 });
    const user = userEvent.setup();
    await focusEnd(user);
    await user.keyboard('typed');
    await user.tab();
    rerender({ value: 'typed' });
    expect(box().textContent).toBe('typed');
  });

  it('applies the Markdown shortcuts of the subset', async () => {
    const { onChange } = setup({ debounceMs: 10 });
    const user = userEvent.setup();
    await focusEnd(user);
    await user.keyboard('## Plan{Enter}- one{Enter}two{Enter}{Enter}[[ ] ');
    await user.keyboard('task');
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const last = onChange.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('## Plan');
    expect(last).toContain('- one');
    expect(last).toContain('- two');
  });

  it('has no motion of its own under reduced motion, and a forced-colors edge', () => {
    const css = readFileSync(join(__dirname, 'notepad.css'), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*{\s*\.notepad\s*{\s*transition: none/);
    expect(css).toMatch(/forced-colors: active/);
    expect(css).not.toMatch(/animation|@keyframes/);
  });
});
