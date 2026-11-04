// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { MicrophoneSection } from './MicrophoneSection';

type Listener = (payload: unknown) => void;

function installApi(saved: string | null, slowLoad = false, slowSettings = false) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Set<Listener>();
  const invoke = (name: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, input });
    if (name === 'audio.microphones.load') {
      const answer = {
        options: [
          { kind: 'None', deviceId: null, name: null },
          { kind: 'SystemDefault', deviceId: null, name: null },
          { kind: 'Device', deviceId: 'mic-1', name: 'Test microphone' },
          { kind: 'Device', deviceId: 'mic-2', name: 'Test headset' },
        ],
        selected: { kind: 'SystemDefault', deviceId: null },
      };
      return slowLoad
        ? new Promise((resolve) => setTimeout(() => resolve(answer), 30))
        : Promise.resolve(answer);
    }
    if (name === 'settings.get') {
      const answer = { selectedMicrophoneDeviceId: saved };
      return slowSettings
        ? new Promise((resolve) => setTimeout(() => resolve(answer), 80))
        : Promise.resolve(answer);
    }
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
    const combo = await screen.findByRole('combobox', { name: 'Default microphone' });
    await waitFor(() => {
      expect(combo).toHaveTextContent('Test headset');
    });
    expect(api.calls.find((c) => c.name === 'audio.preview.start')).toBeTruthy();
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'audio.preview.start').at(-1)?.input).toEqual({
        deviceId: 'mic-2',
        owner: 'settings',
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

  it('waits for the device list, so the preview never opens the default first', async () => {
    const api = installApi('mic-2', true);
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'audio.preview.start')).toBe(true);
    });
    const starts = api.calls.filter((c) => c.name === 'audio.preview.start');
    expect(starts.map((c) => c.input)).toEqual([{ deviceId: 'mic-2', owner: 'settings' }]);
  });

  it('97: shows nothing and saves nothing until both answers arrive', async () => {
    const api = installApi('mic-2', true, true);
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Default microphone' });
    // The placeholder is showing, not a pick: the saved device is not selected yet.
    expect(combo).not.toHaveTextContent('Test headset');
    expect(api.calls.some((c) => c.name === 'settings.update')).toBe(false);
    await waitFor(() => {
      expect(combo).toHaveTextContent('Test headset');
    });
    expect(api.calls.some((c) => c.name === 'settings.update')).toBe(false);
  });

  it('97: a pick made before the saved id arrives is not overwritten by it', async () => {
    installApi('mic-2', false, true);
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Default microphone' });
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'Test microphone' }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(combo).toHaveTextContent('Test microphone');
  });

  it('saves a pick, and System default saves null', async () => {
    const api = installApi(null);
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Default microphone' });
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

  it('96: a pick restarts the preview on the new device, and re-picking it does nothing', async () => {
    const api = installApi('mic-1');
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Default microphone' });
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'audio.preview.start')).toHaveLength(1);
    });
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'Test headset' }));
    await waitFor(() => {
      expect(api.calls.filter((c) => c.name === 'audio.preview.start').at(-1)?.input).toEqual({
        deviceId: 'mic-2',
        owner: 'settings',
      });
    });
    const updates = api.calls.filter((c) => c.name === 'settings.update').length;
    const starts = api.calls.filter((c) => c.name === 'audio.preview.start').length;
    await userEvent.click(combo);
    await userEvent.click(await screen.findByRole('option', { name: 'Test headset' }));
    expect(api.calls.filter((c) => c.name === 'settings.update')).toHaveLength(updates);
    expect(api.calls.filter((c) => c.name === 'audio.preview.start')).toHaveLength(starts);
  });

  it('reads an unplugged saved device as System default', async () => {
    installApi('gone');
    render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    const combo = await screen.findByRole('combobox', { name: 'Default microphone' });
    await waitFor(() => {
      expect(combo).toHaveTextContent('System default');
    });
  });

  it('stops the preview when the page is left (8.12)', async () => {
    const api = installApi('mic-2');
    const view = render(
      <Providers>
        <MicrophoneSection />
      </Providers>,
    );
    await waitFor(() => {
      expect(api.calls.some((call) => call.name === 'audio.preview.start')).toBe(true);
    });
    view.unmount();
    expect(api.calls.some((call) => call.name === 'audio.preview.stop')).toBe(true);
  });
});
