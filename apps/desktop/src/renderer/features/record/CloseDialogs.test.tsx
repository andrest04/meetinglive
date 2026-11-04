// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { CloseDialogs } from './CloseDialogs';

type Listener = (payload: unknown) => void;
let listener: Listener | null = null;
const answers: Record<string, unknown>[] = [];

const send = (requestId: string, dialog: string): void => {
  act(() => {
    listener?.({ requestId, dialog });
  });
};

beforeEach(() => {
  listener = null;
  answers.length = 0;
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke: (_name: string, input: Record<string, unknown>) => {
        answers.push(input);
        return Promise.resolve({ received: true });
      },
      on: (name: string, fn: Listener) => {
        if (name !== 'recording.closeRequest') return () => undefined;
        listener = fn;
        return () => {
          listener = null;
        };
      },
    },
    configurable: true,
    writable: true,
  });
  render(
    <Providers>
      <CloseDialogs />
    </Providers>,
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('CloseDialogs (spec 2.16, item 165)', () => {
  it('asks to stop first, with Keep recording as the default, and answers Stop and save', async () => {
    send('r1', 'confirm-stop');
    const dialog = await screen.findByRole('dialog', { name: 'Stop recording before closing?' });
    expect(screen.getByRole('button', { name: 'Keep recording' })).toHaveFocus();
    expect(dialog).toHaveTextContent('Vozella is still recording.');
    await userEvent.click(screen.getByRole('button', { name: 'Stop and save' }));
    expect(answers).toEqual([{ requestId: 'r1', accepted: true }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('answers no for Keep recording and for Escape', async () => {
    send('r1', 'confirm-stop');
    await userEvent.click(await screen.findByRole('button', { name: 'Keep recording' }));
    send('r2', 'confirm-stop');
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(answers).toEqual([
      { requestId: 'r1', accepted: false },
      { requestId: 'r2', accepted: false },
    ]);
  });

  it('shows the saving dialog until done, and Escape does not close it', async () => {
    send('s1', 'saving');
    const dialog = await screen.findByRole('dialog', { name: 'Saving your recording' });
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Saving your recording' })).toBe(dialog);
    expect(answers).toEqual([]);
    send('s1', 'done');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the failure with Keep open as the default and Close anyway as the accepted answer', async () => {
    send('s1', 'saving');
    await screen.findByRole('dialog', { name: 'Saving your recording' });
    send('s1', 'done');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    send('f1', 'save-failed');
    expect(
      await screen.findByRole('dialog', { name: 'The recording could not be saved' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keep open' })).toHaveFocus();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Close anyway' }));
    expect(answers).toEqual([{ requestId: 'f1', accepted: true }]);
  });
});
