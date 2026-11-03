// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { MicrophoneSection } from './MicrophoneSection';

type Listener = (payload: unknown) => void;

function installApi(saved: string | null) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Set<Listener>();
  const invoke = (name: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, input });
    if (name === 'audio.microphones.load') {
      return Promise.resolve({
        options: [
          { kind: 'None', deviceId: null, name: null },
          { kind: 'SystemDefault', deviceId: null, name: null },
          { kind: 'Device', deviceId: 'mic-1', name: 'Test microphone' },
          { kind: 'Device', deviceId: 'mic-2', name: 'Test headset' },
        ],
        selected: { kind: 'SystemDefault', deviceId: null },
      });
    }
    if (name === 'settings.get') return Promise.resolve({ selectedMicrophoneDeviceId: saved });
    return Promise.resolve({});
  };
  const on = (name: string, listener: Listener) => {
    if (name === 'audio.preview.level') listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  Object.defineProperty(window, 'vozella', { value: { invoke, on }, configurable: true });
  return {
    calls,
    level: (level: number): void => {
      act(() => {
        for (const listener of listeners) listener({ level });
      });
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('MicrophoneSection', () => {
  it('shows the saved device, without the None option, and previews it', async () => {
    const api = installApi('mic-2');
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Microphone' });
    await waitFor(() => {
      expect(combo).toHaveTextContent('Test headset');
    });
    expect(api.calls.find((c) => c.name === 'audio.preview.start')).toBeTruthy();
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'audio.preview.start').at(-1)?.input).toEqual({
        deviceId: 'mic-2',
      });
    });
    api.level(61);
    expect(screen.getByRole('meter', { name: 'Microphone level' })).toHaveAttribute(
      'aria-valuenow',
      '61',
    );
    await userEvent.click(combo);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'System default',
      'Test microphone',
      'Test headset',
    ]);
  });

  it('saves a pick, and System default saves null', async () => {
    const api = installApi(null);
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Microphone' });
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'Test microphone' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.name === 'settings.update')?.input).toEqual({
        patch: { selectedMicrophoneDeviceId: 'mic-1' },
      });
    });
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'System default' }));
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'settings.update').at(-1)?.input).toEqual({
        patch: { selectedMicrophoneDeviceId: null },
      });
    });
  });

  it('reads an unplugged saved device as System default', async () => {
    installApi('gone');
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Microphone' });
    await waitFor(() => {
      expect(combo).toHaveTextContent('System default');
    });
  });
});
