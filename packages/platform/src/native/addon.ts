/**
 * Hand-written type of the vozella-native addon. It mirrors native/vozella-native/src;
 * the contract tests in this package keep the fake and the real adapter in step.
 */
export interface NativeFrame {
  pcm: Uint8Array;
  tsMs: number;
  synthesized: boolean;
}

export interface NativeCaptureStats {
  frames: number;
  realSamples: number;
  synthesizedSamples: number;
  packets: number;
  silentFlagPackets: number;
  discontinuities: number;
}

export interface NativeCalendarProbeResult {
  hasIdentity: boolean;
  packageFullName?: string | null;
  status: string;
  hresult?: string | null;
  error?: string | null;
  calendarCount?: number | null;
  upcomingEventCount?: number | null;
}

export interface NativeProcessDetails {
  processId: number;
  parentProcessId: number;
  exePath?: string | null;
  processName: string;
  startTimeUtcMs?: number | null;
}

export interface NativeSessionSnapshot {
  processId: number;
  isSystemSounds: boolean;
  isStateActive: boolean;
  peak: number;
}

export interface NativeSessionMonitor {
  enumerate(): NativeSessionSnapshot[];
  readPeaks(): NativeSessionSnapshot[];
  dispose(): void;
}

export interface NativeAudioDecoder {
  /** 16 kHz mono PCM16 little-endian, or null at the end of the file. */
  read(): Uint8Array | null;
  close(): void;
}

export interface NativeAddon {
  platformSupported(): boolean;
  startCapture(
    options: { kind: string; deviceId?: string | null; pid?: number; includeTree?: boolean },
    onFrame: (error: Error | null, frame: NativeFrame) => void,
    onStopped: (error: Error | null, info: { error?: string | null }) => void,
  ): { stop(): NativeCaptureStats };
  listMicrophones(): { id: string; name: string }[];
  SessionMonitor: new () => NativeSessionMonitor;
  getProcessDetails(pid: number): NativeProcessDetails | null;
  getVersionDetails(path: string): {
    fileDescription?: string | null;
    productName?: string | null;
  } | null;
  windowsBuild(): number;
  openAudioDecoder(path: string): NativeAudioDecoder;
  probeCalendarsAsync(): Promise<NativeCalendarProbeResult>;
  dpapiUnprotect(data: Uint8Array): Uint8Array;
  /** Puts the process in a Job Object that kills it when this process dies. Throws on failure. */
  assignToKillOnCloseJob(pid: number): void;
}

/**
 * Loads the addon from an explicit path. `load` is the host's `require`; the platform
 * package never guesses where the .node file lives.
 */
export function loadNativeAddon(addonPath: string, load: (path: string) => unknown): NativeAddon {
  const addon = load(addonPath) as Partial<NativeAddon> | null;
  if (
    !addon ||
    typeof addon.platformSupported !== 'function' ||
    typeof addon.startCapture !== 'function' ||
    typeof addon.listMicrophones !== 'function' ||
    typeof addon.SessionMonitor !== 'function' ||
    typeof addon.getProcessDetails !== 'function' ||
    typeof addon.getVersionDetails !== 'function' ||
    typeof addon.windowsBuild !== 'function' ||
    typeof addon.openAudioDecoder !== 'function' ||
    typeof addon.probeCalendarsAsync !== 'function' ||
    typeof addon.dpapiUnprotect !== 'function' ||
    typeof addon.assignToKillOnCloseJob !== 'function'
  ) {
    throw new Error(`native addon at ${addonPath} does not expose the expected API`);
  }
  return addon as NativeAddon;
}
