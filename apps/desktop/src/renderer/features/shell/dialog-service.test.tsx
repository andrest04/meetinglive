// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { DialogHost, useDialogs, type DialogService } from './dialog-service';

afterEach(cleanup);

let service: DialogService;
function Grab() {
  service = useDialogs();
  return null;
}

const mount = () =>
  render(
    <Providers locale="en">
      <DialogHost>
        <Grab />
      </DialogHost>
    </Providers>,
  );

const confirm = { title: 'Delete it?', primaryText: 'Delete', closeText: 'Cancel' };

describe('dialog service (AppDialogFactory, items 133 to 135)', () => {
  it('confirm has a primary and a close button and resolves true for the primary', async () => {
    mount();
    let result: Promise<boolean> | undefined;
    act(() => {
      result = service.confirm({ ...confirm, content: 'This cannot be undone.' });
    });
    expect(await screen.findByText('This cannot be undone.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(result).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirm resolves false for the close button and for Escape', async () => {
    mount();
    let first: Promise<boolean> | undefined;
    act(() => {
      first = service.confirm(confirm);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(first).resolves.toBe(false);

    let second: Promise<boolean> | undefined;
    act(() => {
      second = service.confirm(confirm);
    });
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await expect(second).resolves.toBe(false);
  });

  it('the caller picks the default button: Close by default, Primary on request', async () => {
    mount();
    act(() => {
      void service.confirm(confirm);
    });
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    act(() => {
      void service.confirm({ ...confirm, defaultButton: 'primary' });
    });
    await screen.findByRole('dialog');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    });
  });

  it('error has only a close button, focused', async () => {
    mount();
    let result: Promise<void> | undefined;
    act(() => {
      result = service.error({ title: 'Failed', closeText: 'Close it', content: 'Disk full' });
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelectorAll('[data-testid="DialogPrimary"]')).toHaveLength(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close it' }));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Close it' }));
    await expect(result).resolves.toBeUndefined();
  });

  it('content may be controls', async () => {
    mount();
    act(() => {
      void service.confirm({ ...confirm, content: <input aria-label="Reason" /> });
    });
    await userEvent.type(await screen.findByLabelText('Reason'), 'x');
    expect(screen.getByLabelText<HTMLInputElement>('Reason').value).toBe('x');
  });

  it('a second request waits for the first and never throws (item 134)', async () => {
    mount();
    let first: Promise<boolean> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = service.confirm(confirm);
      second = service.error({ title: 'Second', closeText: 'Dismiss' });
    });
    await screen.findByText('Delete it?');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByText('Second')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(first).resolves.toBe(false);
    expect(await screen.findByText('Second')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await expect(second).resolves.toBeUndefined();
  });
});
