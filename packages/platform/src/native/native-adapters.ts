import type {
  AudioCapturePort,
  AudioFrame,
  AudioSource,
  CalendarProbePort,
  CalendarProbeResult,
  CaptureSession,
  LegacySecretPort,
} from '@vozella/core';
import type { NativeAddon } from './addon';

/** Adapter: audio capture through the Rust addon. */
export class NativeAudioCapture implements AudioCapturePort {
  constructor(
    private readonly addon: NativeAddon,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}

  start(source: AudioSource, onFrame: (frame: AudioFrame) => void): Promise<CaptureSession> {
    try {
      const handle = this.addon.startCapture(
        source.kind === 'process'
          ? { kind: 'process', pid: source.pid, includeTree: source.includeTree }
          : { kind: source.kind },
        (error, frame) => {
          if (error) {
            this.onError(error);
            return;
          }
          onFrame({ pcm: frame.pcm, tsMs: frame.tsMs, synthesized: frame.synthesized });
        },
      );
      return Promise.resolve({ stop: () => handle.stop() });
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/** Adapter: calendar capability probe through the Rust addon. */
export class NativeCalendarProbe implements CalendarProbePort {
  constructor(private readonly addon: NativeAddon) {}

  async probe(): Promise<CalendarProbeResult> {
    const r = await this.addon.probeCalendarsAsync();
    return {
      hasIdentity: r.hasIdentity,
      packageFullName: r.packageFullName ?? null,
      status: r.status === 'ok' ? 'ok' : 'error',
      hresult: r.hresult ?? null,
      error: r.error ?? null,
      calendarCount: r.calendarCount ?? null,
      upcomingEventCount: r.upcomingEventCount ?? null,
    };
  }
}

/** Adapter: legacy DPAPI through the Rust addon. */
export class NativeLegacySecret implements LegacySecretPort {
  constructor(private readonly addon: NativeAddon) {}

  unprotect(blob: Uint8Array): Promise<Uint8Array> {
    try {
      return Promise.resolve(this.addon.dpapiUnprotect(blob));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
