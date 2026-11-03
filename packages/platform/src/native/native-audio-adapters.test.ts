import { describe, expect, it, vi } from 'vitest';
import type { NativeAddon, NativeSessionMonitor, NativeSessionSnapshot } from './addon';
import {
  NativeAudioCapture,
  NativeAudioSessionSource,
  NativeMicrophoneDevices,
  NativeOsBuild,
  NativeProcessInfo,
  openNativeDecoder,
} from './native-adapters';

const noStats = {
  frames: 0,
  realSamples: 0,
  synthesizedSamples: 0,
  packets: 0,
  silentFlagPackets: 0,
  discontinuities: 0,
};

function addon(overrides: Partial<NativeAddon> = {}): NativeAddon {
  return {
    platformSupported: () => true,
    startCapture: () => ({ stop: () => noStats }),
    listMicrophones: () => [],
    SessionMonitor: class implements NativeSessionMonitor {
      enumerate = (): NativeSessionSnapshot[] => [];
      readPeaks = (): NativeSessionSnapshot[] => [];
      dispose = (): void => undefined;
    },
    getProcessDetails: () => null,
    getVersionDetails: () => null,
    windowsBuild: () => 26_300,
    openAudioDecoder: () => ({ read: () => null, close: () => undefined }),
    probeCalendarsAsync: () => Promise.resolve({ hasIdentity: false, status: 'ok' }),
    dpapiUnprotect: (d) => d,
    ...overrides,
  };
}

describe('NativeAudioCapture stop reporting', () => {
  it('passes the microphone device id to the addon, null when absent', async () => {
    const startCapture = vi.fn<NativeAddon['startCapture']>(() => ({ stop: () => noStats }));
    const capture = new NativeAudioCapture(addon({ startCapture }));
    await capture.start({ kind: 'mic', deviceId: 'dev-1' }, () => undefined);
    await capture.start({ kind: 'mic' }, () => undefined);
    expect(startCapture.mock.calls[0]?.[0]).toEqual({ kind: 'mic', deviceId: 'dev-1' });
    // The addon rejects null for an optional field, so an absent id must be left out.
    expect(startCapture.mock.calls[1]?.[0]).toEqual({ kind: 'mic' });
    await capture.start({ kind: 'mic', deviceId: null }, () => undefined);
    expect(startCapture.mock.calls[2]?.[0]).toEqual({ kind: 'mic' });
    await capture.start({ kind: 'mic', deviceId: '' }, () => undefined);
    expect(startCapture.mock.calls[3]?.[0]).toEqual({ kind: 'mic' });
  });

  it('reports a capture that ended by itself with its error, and a clean stop with null', async () => {
    let stopped: (error: Error | null, info: { error?: string | null }) => void = () => undefined;
    const startCapture = vi.fn<NativeAddon['startCapture']>((_o, _f, onStopped) => {
      stopped = onStopped;
      return { stop: () => noStats };
    });
    const seen: (Error | null)[] = [];
    await new NativeAudioCapture(addon({ startCapture })).start(
      { kind: 'process', pid: 7, includeTree: true },
      () => undefined,
      (e) => seen.push(e),
    );
    stopped(null, { error: 'the captured application exited' });
    // Item 78: a second report from the addon is not delivered.
    stopped(null, {});
    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toBe('the captured application exited');

    const second: (Error | null)[] = [];
    await new NativeAudioCapture(addon({ startCapture })).start(
      { kind: 'system' },
      () => undefined,
      (e) => second.push(e),
    );
    stopped(null, {});
    stopped(null, { error: 'late' });
    expect(second).toEqual([null]);
  });

  it('hands a callback error to the error sink instead of the stop listener', async () => {
    let stopped: (error: Error | null, info: { error?: string | null }) => void = () => undefined;
    const startCapture = vi.fn<NativeAddon['startCapture']>((_o, _f, onStopped) => {
      stopped = onStopped;
      return { stop: () => noStats };
    });
    const onError = vi.fn();
    const seen: unknown[] = [];
    await new NativeAudioCapture(addon({ startCapture }), onError).start(
      { kind: 'system' },
      () => undefined,
      (e) => seen.push(e),
    );
    stopped(new Error('napi failure'), {});
    expect(onError).toHaveBeenCalledOnce();
    expect(seen).toEqual([]);
  });
});

describe('NativeMicrophoneDevices', () => {
  it('maps the addon list', () => {
    const devices = new NativeMicrophoneDevices(
      addon({ listMicrophones: () => [{ id: 'a', name: 'Mic A' }] }),
    );
    expect(devices.list()).toEqual([{ id: 'a', name: 'Mic A' }]);
  });
});

describe('NativeAudioSessionSource', () => {
  it('enumerates through one monitor and reads the max peak per process', () => {
    const monitor: NativeSessionMonitor = {
      enumerate: () => [{ processId: 5, isSystemSounds: false, isStateActive: true, peak: 0.2 }],
      readPeaks: () => [
        { processId: 5, isSystemSounds: false, isStateActive: false, peak: 0.3 },
        { processId: 5, isSystemSounds: false, isStateActive: false, peak: 0.6 },
      ],
      dispose: vi.fn(),
    };
    const created = vi.fn();
    const source = new NativeAudioSessionSource(
      addon({
        SessionMonitor: vi.fn(function () {
          created();
          return monitor;
        }) as unknown as NativeAddon['SessionMonitor'],
      }),
    );
    expect(source.enumerate()).toHaveLength(1);
    source.enumerate();
    expect(created).toHaveBeenCalledOnce();
    expect(source.readPeaks()).toEqual(new Map([[5, 0.6]]));
    source.dispose();
    expect(monitor.dispose).toHaveBeenCalledOnce();
  });

  it('gives an empty list and no peaks when the addon throws', () => {
    const source = new NativeAudioSessionSource(
      addon({
        SessionMonitor: vi.fn(function () {
          throw new Error('com failed');
        }) as unknown as NativeAddon['SessionMonitor'],
      }),
    );
    expect(source.enumerate()).toEqual([]);
    expect(source.readPeaks().size).toBe(0);
  });
});

describe('NativeProcessInfo', () => {
  it('maps optional fields to null and a missing process to null', () => {
    const info = new NativeProcessInfo(
      addon({
        getProcessDetails: (pid) =>
          pid === 1 ? { processId: 1, parentProcessId: 0, processName: 'x' } : null,
        getVersionDetails: () => ({ fileDescription: 'Desc' }),
      }),
    );
    expect(info.getProcess(1)).toEqual({
      processId: 1,
      parentProcessId: 0,
      exePath: null,
      processName: 'x',
      startTimeUtcMs: null,
    });
    expect(info.getProcess(2)).toBeNull();
    expect(info.getVersionInfo('a.exe')).toEqual({ fileDescription: 'Desc', productName: null });
  });

  it('returns null version info when the addon throws', () => {
    const info = new NativeProcessInfo(
      addon({
        getVersionDetails: () => {
          throw new Error('denied');
        },
      }),
    );
    expect(info.getVersionInfo('a.exe')).toBeNull();
  });
});

describe('NativeOsBuild and decoder', () => {
  it('reads the build and opens a decoder through the addon', () => {
    expect(new NativeOsBuild(addon({ windowsBuild: () => 19_045 })).windowsBuild()).toBe(19_045);
    const close = vi.fn();
    const decoder = openNativeDecoder(
      addon({ openAudioDecoder: () => ({ read: () => new Uint8Array(2), close }) }),
      'x.mp3',
    );
    expect(decoder.read()).toEqual(new Uint8Array(2));
    decoder.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
