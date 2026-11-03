import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioCapturePort, AudioFrame, CaptureSession } from '@vozella/core';
import { FakeAudioCapture } from '../fakes/fake-audio-capture';
import { FakeLegacySecret } from '../fakes/fake-legacy-secret';
import { loadNativeAddon, type NativeAddon, type NativeFrame } from './addon';
import { createNativePorts } from './create-native-ports';
import { NativeAudioCapture } from './native-adapters';

/** A stand-in addon with the same surface as the Rust one. */
function stubAddon(overrides: Partial<NativeAddon> = {}): NativeAddon {
  return {
    platformSupported: () => true,
    listMicrophones: () => [{ id: 'mic-1', name: 'Mic one' }],
    SessionMonitor: class {
      enumerate = () => [];
      readPeaks = () => [];
      dispose = () => undefined;
    },
    getProcessDetails: () => null,
    getVersionDetails: () => null,
    windowsBuild: () => 26_300,
    openAudioDecoder: () => ({ read: () => null, close: () => undefined }),
    startCapture: (_options, onFrame) => {
      const frame: NativeFrame = { pcm: new Uint8Array(640), tsMs: 0, synthesized: false };
      queueMicrotask(() => onFrame(null, frame));
      return {
        stop: () => ({
          frames: 1,
          realSamples: 320,
          synthesizedSamples: 0,
          packets: 1,
          silentFlagPackets: 0,
          discontinuities: 0,
        }),
      };
    },
    probeCalendarsAsync: () =>
      Promise.resolve({
        hasIdentity: false,
        status: 'ok',
        calendarCount: 2,
        upcomingEventCount: 0,
      }),
    dpapiUnprotect: (data) => data,
    assignToKillOnCloseJob: () => undefined,
    ...overrides,
  };
}

/** The same assertions run against the fake and the native adapter. */
function audioContract(name: string, make: () => AudioCapturePort) {
  describe(`AudioCapturePort contract: ${name}`, () => {
    let session: CaptureSession | undefined;

    afterEach(() => {
      session?.stop();
      vi.useRealTimers();
    });

    it('delivers 20 ms PCM16 frames and stats on stop', async () => {
      const frames: AudioFrame[] = [];
      session = await make().start({ kind: 'mic' }, (f) => frames.push(f));
      await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 1000 });
      expect(frames[0]?.pcm.byteLength).toBe(640);
      const stats = session.stop();
      expect(stats.frames).toBeGreaterThan(0);
      session = undefined;
    });
  });
}

audioContract('fake', () => new FakeAudioCapture());
audioContract('native adapter over a stub addon', () => new NativeAudioCapture(stubAddon()));

describe('NativeAudioCapture', () => {
  it('rejects when the device cannot be opened', async () => {
    const addon = stubAddon({
      startCapture: () => {
        throw new Error('no device');
      },
    });
    await expect(
      new NativeAudioCapture(addon).start({ kind: 'system' }, () => undefined),
    ).rejects.toThrow('no device');
  });

  it('passes the process source options through', async () => {
    const startCapture = vi.fn<NativeAddon['startCapture']>(() => ({
      stop: () => ({
        frames: 0,
        realSamples: 0,
        synthesizedSamples: 0,
        packets: 0,
        silentFlagPackets: 0,
        discontinuities: 0,
      }),
    }));
    await new NativeAudioCapture(stubAddon({ startCapture })).start(
      { kind: 'process', pid: 42, includeTree: false },
      () => undefined,
    );
    expect(startCapture.mock.calls[0]?.[0]).toEqual({
      kind: 'process',
      pid: 42,
      includeTree: false,
    });
  });
});

describe('FakeAudioCapture', () => {
  it('can be told to fail', async () => {
    await expect(
      new FakeAudioCapture({ failWith: 'denied' }).start({ kind: 'mic' }, () => undefined),
    ).rejects.toThrow('denied');
  });
});

describe('createNativePorts', () => {
  it('builds fakes without touching the filesystem', () => {
    const ports = createNativePorts({ fake: true });
    expect(ports.backend).toBe('fake');
  });

  it('builds native adapters from an addon loaded by path', async () => {
    const load = vi.fn(() => stubAddon());
    const ports = createNativePorts({ fake: false, addonPath: 'x.node', load });
    expect(load).toHaveBeenCalledWith('x.node');
    expect(ports.backend).toBe('native');
    expect(await ports.calendar.probe()).toMatchObject({
      status: 'ok',
      calendarCount: 2,
      packageFullName: null,
    });
  });

  it('rejects an addon with the wrong shape', () => {
    expect(() => loadNativeAddon('x.node', () => ({}))).toThrow(/expected API/);
  });
});

describe('FakeLegacySecret', () => {
  it('decrypts registered blobs and fails for the rest', async () => {
    const secret = new FakeLegacySecret();
    secret.register(new Uint8Array([1, 2]), new Uint8Array([9]));
    expect(await secret.unprotect(new Uint8Array([1, 2]))).toEqual(new Uint8Array([9]));
    await expect(secret.unprotect(new Uint8Array([3]))).rejects.toThrow(/invalid/);
  });
});
