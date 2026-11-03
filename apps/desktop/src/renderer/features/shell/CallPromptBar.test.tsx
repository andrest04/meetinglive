// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { CallPromptBar } from './CallPromptBar';

type Listener = (payload: unknown) => void;

function install() {
  const listeners = new Set<Listener>();
  const invoke = vi.fn((_name: string, _input: unknown) => Promise.resolve({}));
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke,
      on: (name: string, listener: Listener) => {
        if (name === 'workspace.callPromptOffered') listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    invoke,
    offer: () => {
      act(() => {
        listeners.forEach((listener) => {
          listener({});
        });
      });
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = (locale: 'en' | 'es' = 'en') =>
  render(
    <Providers locale={locale}>
      <CallPromptBar />
    </Providers>,
  );

describe('CallPromptBar (items 111, 112)', () => {
  it('is hidden until a call is offered, then shows the three texts and the ids', () => {
    const api = install();
    const { container } = mount();
    expect(container.querySelector('#InfoCallPrompt')).toBeNull();
    api.offer();
    expect(container.querySelector('#InfoCallPrompt')).not.toBeNull();
    expect(screen.getByText('A call is happening')).toBeTruthy();
    expect(screen.getByText("Take notes in Vozella so you don't miss it.")).toBeTruthy();
    expect(container.querySelector('#BtnCallPromptTakeNotes')?.textContent).toBe('Take notes');
  });

  it('W2: Take notes closes the bar and requests a blank take', async () => {
    const api = install();
    const { container } = mount();
    api.offer();
    await userEvent.click(screen.getByRole('button', { name: 'Take notes' }));
    expect(container.querySelector('#InfoCallPrompt')).toBeNull();
    expect(api.invoke).toHaveBeenCalledWith('workspace.dispatch', {
      action: { type: 'requestTakeNotes' },
    });
  });

  it('the close button closes it without a request', async () => {
    const api = install();
    const { container } = mount();
    api.offer();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(container.querySelector('#InfoCallPrompt')).toBeNull();
    expect(api.invoke).not.toHaveBeenCalled();
  });

  it('nothing closes it on its own', () => {
    vi.useFakeTimers();
    try {
      const api = install();
      const { container } = mount();
      api.offer();
      act(() => {
        vi.advanceTimersByTime(10 * 60_000);
      });
      expect(container.querySelector('#InfoCallPrompt')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads in Spanish', () => {
    const api = install();
    mount('es');
    api.offer();
    expect(screen.getByText('Hay una llamada en curso')).toBeTruthy();
    expect(screen.getByText('Tomar notas')).toBeTruthy();
  });
});
