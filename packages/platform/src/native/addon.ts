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

export interface NativeAddon {
  platformSupported(): boolean;
  startCapture(
    options: { kind: string; pid?: number; includeTree?: boolean },
    onFrame: (error: Error | null, frame: NativeFrame) => void,
  ): { stop(): NativeCaptureStats };
  probeCalendarsAsync(): Promise<NativeCalendarProbeResult>;
  dpapiUnprotect(data: Uint8Array): Uint8Array;
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
    typeof addon.probeCalendarsAsync !== 'function' ||
    typeof addon.dpapiUnprotect !== 'function'
  ) {
    throw new Error(`native addon at ${addonPath} does not expose the expected API`);
  }
  return addon as NativeAddon;
}
