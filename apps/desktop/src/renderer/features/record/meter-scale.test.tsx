// @vitest-environment jsdom
import { toMeterPercent } from '@vozella/core';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MicrophoneSection } from '../audio/MicrophoneSection';
import { Providers } from '../library/library-test-kit';
import { RecordingLevel } from './RecordingLevel';

type Listener = (payload: unknown) => void;

function installApi() {
  const listeners = new Map<string, Set<Listener>>();
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke: (name: string) => {
        if (name === 'audio.microphones.load') {
          return Promise.resolve({
            options: [{ kind: 'SystemDefault', deviceId: null, name: null }],
            selected: { kind: 'SystemDefault', deviceId: null },
          });
        }
        if (name === 'settings.get') return Promise.resolve({ selectedMicrophoneDeviceId: null });
        return Promise.resolve({});
      },
      on: (name: string, listener: Listener) => {
        const set = listeners.get(name) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(name, set);
        return () => {
          set.delete(listener);
        };
      },
    },
    configurable: true,
    writable: true,
  });
  return (name: string, payload: unknown): void => {
    act(() => {
      for (const l of listeners.get(name) ?? []) l(payload);
    });
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('one dB scale on every page (B-14)', () => {
  // The audio worker applies toMeterPercent to the idle preview and to the recording level, so
  // the same voice reads the same on Settings and on the Record bar. Neither page rescales.
  const speech = toMeterPercent(0.05);

  it('is the spec value for typical speech: about 56', () => {
    expect(Math.round(speech)).toBe(57);
    expect(toMeterPercent(10 ** (-30 / 20))).toBeCloseTo(50, 5);
    expect(toMeterPercent(0)).toBe(0);
    expect(toMeterPercent(1)).toBe(100);
  });

  it('draws the same bar value on the Settings microphone meter and the recording bar', async () => {
    const emit = installApi();
    render(
      <Providers>
        <MicrophoneSection />
        <RecordingLevel paused={false} />
      </Providers>,
    );
    await screen.findByRole('combobox', { name: 'Default microphone' });
    await waitFor(() => {
      expect(screen.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    });
    emit('audio.preview.level', { level: speech });
    emit('audio.recording.level', { level: speech });
    const settings = screen.getByRole('meter', { name: 'Microphone level' });
    const bar = screen.getByRole('meter', { name: 'Recording level' });
    expect(settings.getAttribute('aria-valuenow')).toBe(bar.getAttribute('aria-valuenow'));
    expect(bar).toHaveAttribute('aria-valuenow', String(Math.round(speech)));
  });
});
