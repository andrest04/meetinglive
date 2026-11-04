// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { DialogHost } from './dialog-service';
import { StartupNotice } from './StartupNotice';

function install(startupError: string | null) {
  const invoke = vi.fn((name: string) =>
    name === 'library.getLocation'
      ? Promise.resolve({ startupError })
      : Promise.reject(new Error(`unexpected ${name}`)),
  );
  Object.defineProperty(window, 'vozella', {
    value: { invoke, on: () => () => undefined },
    configurable: true,
    writable: true,
  });
  return invoke;
}

const mount = (locale: 'en' | 'es' = 'en') =>
  render(
    <Providers locale={locale}>
      <DialogHost>
        <StartupNotice />
      </DialogHost>
    </Providers>,
  );

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('StartupNotice (item 9, bug 7)', () => {
  it('shows one OK dialog with the title, the text and the exception message', async () => {
    install('EPERM: operation not permitted');
    mount();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Meeting history migration failed');
    expect(dialog.textContent).toContain('Your original data was left untouched.');
    expect(dialog.textContent).toContain('EPERM: operation not permitted');
    expect(screen.getAllByRole('button', { name: 'OK' })).toHaveLength(1);
  });

  it('is dismissed once per launch: a remount does not show it again', async () => {
    install('boom');
    const first = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    const invoke = install('boom');
    mount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows nothing when the migration worked', async () => {
    const invoke = install(null);
    mount();
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reads in Spanish', async () => {
    install('x');
    mount('es');
    expect((await screen.findByRole('dialog')).textContent).toContain(
      'Error al migrar el historial de reuniones',
    );
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeTruthy();
  });
});
