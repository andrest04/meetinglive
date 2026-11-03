// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { CallDetectionSection } from './CallDetectionSection';

type Listener = (payload: unknown) => void;

function install(initial: boolean) {
  const listeners = new Set<Listener>();
  const invoke = vi.fn((name: string, input: { patch?: { meetingPopupEnabled: boolean } }) => {
    if (name === 'settings.get') return Promise.resolve({ meetingPopupEnabled: initial });
    if (name === 'settings.update') {
      return Promise.resolve({ meetingPopupEnabled: input.patch?.meetingPopupEnabled });
    }
    return Promise.reject(new Error(name));
  });
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke,
      on: (name: string, listener: Listener) => {
        if (name === 'settings.meetingPopupChanged') listeners.add(listener);
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
    broadcast: (enabled: boolean) => {
      act(() => {
        listeners.forEach((listener) => {
          listener({ enabled });
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
      <CallDetectionSection />
    </Providers>,
  );

const toggle = () => screen.getByRole('switch');
const checked = () => toggle().getAttribute('aria-checked');

describe('CallDetectionSection (items 135, 136, 140)', () => {
  it('G1: shows the Calendar heading and only the popup toggle', async () => {
    install(true);
    const { container } = mount();
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeTruthy();
    expect(screen.getByText('Show a popup when a call starts')).toBeTruthy();
    expect(container.querySelector('#ToggleMeetingPopup')).not.toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    await waitFor(() => {
      expect(checked()).toBe('true');
    });
  });

  it.each([true, false])('G2: applies the saved value %s without writing back', async (saved) => {
    const api = install(saved);
    mount();
    await waitFor(() => {
      expect(checked()).toBe(String(saved));
    });
    expect(api.invoke.mock.calls.map((call) => call[0])).toEqual(['settings.get']);
  });

  it('G6: a change patches only the popup field', async () => {
    const api = install(true);
    mount();
    await waitFor(() => {
      expect(checked()).toBe('true');
    });
    await userEvent.click(toggle());
    expect(api.invoke).toHaveBeenCalledWith('settings.update', {
      patch: { meetingPopupEnabled: false },
    });
    await waitFor(() => {
      expect(checked()).toBe('false');
    });
  });

  it('S9: follows the Never again broadcast', async () => {
    const api = install(true);
    mount();
    await waitFor(() => {
      expect(checked()).toBe('true');
    });
    api.broadcast(false);
    await waitFor(() => {
      expect(checked()).toBe('false');
    });
  });

  it('D4: reads in Spanish', () => {
    install(true);
    mount('es');
    expect(screen.getByText('Mostrar un aviso cuando empieza una llamada')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Calendario' })).toBeTruthy();
  });
});
