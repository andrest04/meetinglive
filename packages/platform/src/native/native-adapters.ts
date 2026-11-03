import type {
  AudioCapturePort,
  AudioFileDecoder,
  AudioFrame,
  AudioSessionSnapshot,
  AudioSessionSource,
  AudioSource,
  CalendarProbePort,
  CalendarProbeResult,
  CaptureSession,
  CaptureStopped,
  FileVersionInfo,
  LegacySecretPort,
  MicrophoneDevice,
  MicrophoneDeviceSource,
  OsBuildProbe,
  ProcessDetails,
  ProcessInfoProvider,
} from '@vozella/core';
import type { NativeAddon, NativeSessionMonitor } from './addon';
import type { TopLevelWindowInfo, WindowLister } from './window-scanner';

/** Adapter: audio capture through the Rust addon. */
export class NativeAudioCapture implements AudioCapturePort {
  constructor(
    private readonly addon: NativeAddon,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}

  start(
    source: AudioSource,
    onFrame: (frame: AudioFrame) => void,
    onStopped?: CaptureStopped,
  ): Promise<CaptureSession> {
    try {
      let stoppedReported = false;
      const handle = this.addon.startCapture(
        source.kind === 'process'
          ? { kind: 'process', pid: source.pid, includeTree: source.includeTree }
          : source.kind === 'mic'
            ? // napi reads a missing field as None but rejects null, so the id is left out.
              source.deviceId
              ? { kind: 'mic', deviceId: source.deviceId }
              : { kind: 'mic' }
            : { kind: source.kind },
        (error, frame) => {
          if (error) {
            this.onError(error);
            return;
          }
          onFrame({ pcm: frame.pcm, tsMs: frame.tsMs, synthesized: frame.synthesized });
        },
        (error, info) => {
          if (error) {
            this.onError(error);
            return;
          }
          // Item 78: the stop is reported once per capture, whatever the addon does.
          if (stoppedReported) return;
          stoppedReported = true;
          const reason = info.error;
          onStopped?.(reason ? new Error(reason) : null);
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

/** Adapter: top-level window listing through the Rust addon (runs off the JS loop). */
export class NativeWindowLister implements WindowLister {
  constructor(private readonly addon: NativeAddon) {}

  listWindows(): Promise<readonly TopLevelWindowInfo[]> {
    return this.addon.listTopLevelWindows();
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

/** Adapter: the active capture endpoints through the Rust addon. */
export class NativeMicrophoneDevices implements MicrophoneDeviceSource {
  constructor(private readonly addon: NativeAddon) {}

  list(): MicrophoneDevice[] {
    return this.addon.listMicrophones().map((d) => ({ id: d.id, name: d.name }));
  }
}

/** Adapter: render sessions and their peaks through the Rust addon. */
export class NativeAudioSessionSource implements AudioSessionSource {
  private monitor: NativeSessionMonitor | undefined;

  constructor(private readonly addon: NativeAddon) {}

  enumerate(): readonly AudioSessionSnapshot[] {
    try {
      this.monitor ??= new this.addon.SessionMonitor();
      return this.monitor.enumerate();
    } catch {
      return [];
    }
  }

  readPeaks(): ReadonlyMap<number, number> {
    const peaks = new Map<number, number>();
    try {
      for (const s of this.monitor?.readPeaks() ?? []) {
        peaks.set(s.processId, Math.max(peaks.get(s.processId) ?? 0, s.peak));
      }
    } catch {
      // Meters are best effort.
    }
    return peaks;
  }

  dispose(): void {
    this.monitor?.dispose();
    this.monitor = undefined;
  }
}

/** Adapter: process and file-version queries through the Rust addon. */
export class NativeProcessInfo implements ProcessInfoProvider {
  constructor(private readonly addon: NativeAddon) {}

  getProcess(processId: number): ProcessDetails | null {
    const p = this.addon.getProcessDetails(processId);
    if (!p) return null;
    return {
      processId: p.processId,
      parentProcessId: p.parentProcessId,
      exePath: p.exePath ?? null,
      processName: p.processName,
      startTimeUtcMs: p.startTimeUtcMs ?? null,
    };
  }

  getVersionInfo(exePath: string): FileVersionInfo | null {
    try {
      const v = this.addon.getVersionDetails(exePath);
      if (!v) return null;
      return { fileDescription: v.fileDescription ?? null, productName: v.productName ?? null };
    } catch {
      return null;
    }
  }
}

/** Adapter: the Windows build number. */
export class NativeOsBuild implements OsBuildProbe {
  constructor(private readonly addon: NativeAddon) {}

  windowsBuild(): number {
    return this.addon.windowsBuild();
  }
}

/** Opens audio files through Media Foundation: 16 kHz mono PCM16 out, any channel count in. */
export function openNativeDecoder(addon: NativeAddon, path: string): AudioFileDecoder {
  const decoder = addon.openAudioDecoder(path);
  return { read: () => decoder.read(), close: () => decoder.close() };
}
