// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { MessageList } from './MessageList';
import type { ChatRow } from './chat-view-model';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rowsWith = (text: string): readonly ChatRow[] => [
  { id: 'u', role: 'user', text: 'Question', pending: false },
  { id: 'a', role: 'assistant', text, pending: text === '' },
];

describe('auto-scroll (item 36)', () => {
  it('moves the view to the end on every streamed text change, not only when settled', () => {
    // jsdom has no layout: the content height grows with the streamed text.
    let height = 0;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => height);
    const view = (text: string) => (
      <Providers locale="en">
        <MessageList rows={rowsWith(text)} onCopy={() => Promise.resolve(true)} onLink={vi.fn()} />
      </Providers>
    );
    const { rerender } = render(view(''));
    const scroller = () => {
      const parent = screen.getByTestId('ListMeetingChat').parentElement;
      if (!parent) throw new Error('no scroller');
      return parent;
    };
    for (const [text, scrollHeight] of [
      ['One', 500],
      ['One two', 700],
      ['One two three', 900],
    ] as const) {
      height = scrollHeight;
      rerender(view(text));
      expect(scroller().scrollTop).toBe(scrollHeight);
    }
  });
});
