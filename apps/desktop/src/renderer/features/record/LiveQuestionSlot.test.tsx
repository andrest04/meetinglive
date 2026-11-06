// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { LiveAskDock } from './LiveAskDock';
import { LiveQuestionSlot } from './LiveQuestionSlot';
import { resetLiveAskStore } from './use-live-ask';
import { resetLiveQuestionsStore } from './use-live-questions';

const calls: { name: string; input: Record<string, unknown> }[] = [];
const listeners = new Map<string, (payload: unknown) => void>();
let accept = true;

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
  accept = true;
  window.localStorage.clear();
  resetLiveAskStore();
  resetLiveQuestionsStore();
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke: (name: string, input: Record<string, unknown>) => {
        calls.push({ name, input });
        return Promise.resolve({ accepted: accept, dismissed: true });
      },
      on: (name: string, listener: (payload: unknown) => void) => {
        listeners.set(name, listener);
        return () => listeners.delete(name);
      },
    },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const QUESTION = '¿Cuál es el tercer principio del manifiesto ágil?';

const emit = (name: string, payload: unknown): void => {
  act(() => {
    listeners.get(name)?.(payload);
  });
};
const detect = (confirmed = true, id = 'q1', body = QUESTION): void => {
  emit('recording.questionDetected', { id, body, atMs: 4000, confirmed });
};
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const mountSlot = () =>
  render(
    <Providers>
      <LiveQuestionSlot />
    </Providers>,
  );

describe('LiveQuestionSlot', () => {
  it('shows the card with the quoted question and announces it politely', () => {
    mountSlot();
    expect(screen.queryByTestId('LiveQuestionCard')).toBeNull();
    const region = screen.getByTestId('LiveQuestionAnnouncement');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    detect();
    expect(screen.getByRole('region', { name: 'Question detected' })).toBeTruthy();
    expect(screen.getByTestId('LiveQuestionBody').textContent).toBe(QUESTION);
    expect(region.textContent).toBe(`Question detected: ${QUESTION}`);
    expect(screen.queryByTestId('LiveQuestionChecking')).toBeNull();
  });

  it('marks a card whose engine check still runs, and drops the mark once confirmed', () => {
    mountSlot();
    detect(false);
    expect(screen.getByTestId('LiveQuestionChecking').textContent).toBe('Checking…');
    detect(true);
    expect(screen.queryByTestId('LiveQuestionChecking')).toBeNull();
  });

  it('Answer asks the question through the live ask and then removes the card everywhere', async () => {
    mountSlot();
    detect();
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await flush();
    expect(calls).toEqual([
      { name: 'recording.ask', input: { question: QUESTION, webSearch: false } },
      { name: 'recording.dismissQuestion', input: { id: 'q1' } },
    ]);
    expect(screen.queryByTestId('LiveQuestionCard')).toBeNull();
  });

  it('keeps the card when main did not take the question', async () => {
    accept = false;
    mountSlot();
    detect();
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));
    await flush();
    expect(calls.map((c) => c.name)).toEqual(['recording.ask']);
    expect(screen.getByTestId('LiveQuestionCard')).toBeTruthy();
  });

  it('Dismiss removes the card and tells main', async () => {
    mountSlot();
    detect();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('LiveQuestionCard')).toBeNull();
    expect(calls).toEqual([{ name: 'recording.dismissQuestion', input: { id: 'q1' } }]);
  });

  it('a withdrawn card goes; a withdrawal of an older id leaves the newer card', () => {
    mountSlot();
    detect(true, 'q1');
    detect(true, 'q2', 'what is the first principle of the agile manifesto?');
    emit('recording.questionWithdrawn', { id: 'q1' });
    expect(screen.getByTestId('LiveQuestionBody').textContent).toContain('first principle');
    emit('recording.questionWithdrawn', { id: 'q2' });
    expect(screen.queryByTestId('LiveQuestionCard')).toBeNull();
  });

  it('Ctrl+Enter outside a text box answers the card', async () => {
    mountSlot();
    detect();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await flush();
    expect(calls[0]).toEqual({
      name: 'recording.ask',
      input: { question: QUESTION, webSearch: false },
    });
  });

  it('Ctrl+Enter in the live ask box asks the typed text, not the card', async () => {
    render(
      <Providers>
        <LiveAskDock enabled />
      </Providers>,
    );
    detect();
    const box = screen.getByRole('textbox', { name: 'Type a question' });
    await userEvent.type(box, 'What is the budget?');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await flush();
    expect(calls).toEqual([
      { name: 'recording.ask', input: { question: 'What is the budget?', webSearch: false } },
    ]);
    expect(screen.getByTestId('LiveQuestionCard')).toBeTruthy();
  });

  it('a hidden slot neither shows nor announces the card', () => {
    render(
      <Providers>
        <LiveQuestionSlot show={false} />
      </Providers>,
    );
    detect();
    expect(screen.queryByTestId('LiveQuestionCard')).toBeNull();
    expect(screen.getByTestId('LiveQuestionAnnouncement').textContent).toBe('');
  });
});
