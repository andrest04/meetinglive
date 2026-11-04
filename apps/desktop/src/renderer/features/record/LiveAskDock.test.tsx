// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { AnswerCard } from './AnswerCard';
import { LiveAskDock } from './LiveAskDock';
import { applyAnswer, IDLE_ANSWER, resetLiveAskStore } from './use-live-ask';

const calls: { name: string; input: Record<string, unknown> }[] = [];

beforeEach(() => {
  calls.length = 0;
  window.localStorage.clear();
  resetLiveAskStore();
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke: (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input });
        return Promise.resolve({ accepted: true, cancelled: false });
      },
      on: () => () => undefined,
    },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = (enabled = true) =>
  render(
    <Providers>
      <LiveAskDock enabled={enabled} />
    </Providers>,
  );

const answer = (extra: Partial<typeof IDLE_ANSWER>) => {
  act(() => {
    applyAnswer({ ...IDLE_ANSWER, ...extra });
  });
};

describe('LiveAskDock', () => {
  it('asks on Ctrl+Enter inside the box and ignores a plain Enter', async () => {
    mount();
    const box = screen.getByRole('textbox', { name: 'Type a question' });
    await userEvent.type(box, 'What is the budget?{Enter}');
    expect(calls).toHaveLength(0);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(calls).toEqual([
      { name: 'recording.ask', input: { question: 'What is the budget?', webSearch: false } },
    ]);
  });

  it('does not ask for a blank question', async () => {
    mount();
    await userEvent.type(screen.getByRole('textbox', { name: 'Type a question' }), '   ');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(calls).toHaveLength(0);
  });

  it('disables the web toggle until the provider can search, and says why', () => {
    mount();
    const toggle = screen.getByRole('button', { name: 'No web search with this provider' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('id', 'ToggleLiveWebSearch');
  });

  it('keeps the toggle state between takes and sends it with the question', async () => {
    mount();
    answer({ canUseWebSearch: true });
    const toggle = screen.getByRole('button', { name: 'Search the web for the answer' });
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // A new take resets the answer but not the toggle.
    answer({ canUseWebSearch: true, text: '' });
    expect(screen.getByRole('button', { name: 'Search the web for the answer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Type a question' }), 'Who is it?');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(calls[0]?.input).toEqual({ question: 'Who is it?', webSearch: true });
  });

  it('shows the progress ring named Answering only while answering', () => {
    mount();
    expect(screen.queryByRole('progressbar', { name: 'Answering' })).toBeNull();
    answer({ isAnswering: true });
    expect(screen.getByRole('progressbar', { name: 'Answering' })).toBeInTheDocument();
  });

  it('shows the error bar for a catalog key and for ready text', () => {
    mount();
    answer({ error: { key: 'Ui_LiveAnswerNoProvider', text: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not answer');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pick a summary engine in Settings to get answers during a take.',
    );
    answer({ error: { key: null, text: 'The CLI failed.' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The CLI failed.');
  });

  it('locks the box when the take is not recording', () => {
    mount(false);
    expect(screen.getByRole('textbox', { name: 'Type a question' })).toBeDisabled();
  });
});

describe('AnswerCard', () => {
  const renderCard = (extra: Partial<typeof IDLE_ANSWER>) =>
    render(
      <Providers>
        <AnswerCard answer={{ ...IDLE_ANSWER, ...extra }} />
      </Providers>,
    );

  it('draws nothing without an answer', () => {
    renderCard({});
    expect(screen.queryByTestId('answer-card')).toBeNull();
  });

  it('shows the heading and a scrollable, selectable text of at most 160 px', () => {
    renderCard({ text: 'Line one\nLine two' });
    expect(screen.getByRole('heading', { name: 'Answer' })).toBeInTheDocument();
    const text = screen.getByRole('region', { name: 'Live answer' });
    expect(text).toHaveTextContent('Line one');
    expect(text.className).toContain('max-h-[160px]');
    expect(text.className).toContain('select-text');
    expect(text).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText('Searched the web')).toBeNull();
  });

  it('marks an answer that used the web, without an emoji', () => {
    renderCard({ text: 'Found it.', usedWeb: true });
    expect(screen.getByText('Searched the web').textContent).toBe('Searched the web');
  });
});
