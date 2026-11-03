// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { DataSection } from './DataSection';

const MEETINGS = 'C:/Temp/Vozella/meetings';
const APP_DATA = 'C:/Temp/Vozella/app';

const location = (extra: Record<string, unknown> = {}) => ({
  libraryRoot: MEETINGS,
  appDataRoot: APP_DATA,
  source: 'default',
  sharesMeetingLive: false,
  version: '1.2.3.4',
  startupError: null,
  ...extra,
});

function install(handlers: Record<string, (input: unknown) => unknown>) {
  const calls: string[] = [];
  const api = {
    invoke: vi.fn((name: string, input: unknown) => {
      calls.push(name);
      const handler = handlers[name];
      if (!handler) throw new Error(`unhandled ${name}`);
      return Promise.resolve(handler(input));
    }),
    on: () => () => undefined,
  };
  Object.defineProperty(window, 'vozella', { value: api, configurable: true, writable: true });
  return { api, calls };
}

const mount = () =>
  render(
    <Providers>
      <DataSection />
    </Providers>,
  );

describe('Settings data and about', () => {
  it('shows both folders and the version, and opens the meetings folder', async () => {
    const { calls } = install({
      'library.getLocation': () => location(),
      'library.openFolder': () => ({ opened: true, error: null }),
    });
    mount();
    expect(await screen.findByText(MEETINGS)).toBeInTheDocument();
    expect(screen.getByText(APP_DATA)).toBeInTheDocument();
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use the default folder' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => {
      expect(calls).toContain('library.openFolder');
    });
  });

  it('says when the folder could not be opened', async () => {
    install({
      'library.getLocation': () => location(),
      'library.openFolder': () => ({ opened: false, error: 'access denied' }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Open folder' }));
    expect(await screen.findByText('The folder could not be opened: access denied')).toBeVisible();
  });

  it('warns about a shared earlier-version folder and offers to go back to the default', async () => {
    const { api } = install({
      'library.getLocation': () => location({ source: 'chosen', sharesMeetingLive: true }),
      'library.setLocation': () => ({ status: 'changed', location: location() }),
    });
    mount();
    expect(await screen.findByText(/holds a library from an earlier version/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Use the default folder' }));
    expect(api.invoke).toHaveBeenCalledWith('library.setLocation', { path: null });
    await waitFor(() => {
      expect(screen.queryByText(/holds a library from an earlier version/)).toBeNull();
    });
  });

  it('shows why a picked folder was refused and keeps the old one', async () => {
    install({
      'library.getLocation': () => location(),
      'library.chooseLocation': () => ({
        status: 'refused',
        reason: 'forbidden',
        message: 'Not allowed while testing.',
      }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose folder' }));
    expect(
      await screen.findByText('That folder cannot be used. Not allowed while testing.'),
    ).toBeVisible();
    expect(screen.getByText(MEETINGS)).toBeInTheDocument();
  });
});
