import type { AudioCapturePort, CalendarProbePort, LegacySecretPort } from '@vozella/core';
import { FakeAudioCapture } from '../fakes/fake-audio-capture';
import { FakeCalendarProbe } from '../fakes/fake-calendar-probe';
import { FakeLegacySecret } from '../fakes/fake-legacy-secret';
import { loadNativeAddon } from './addon';
import { NativeAudioCapture, NativeCalendarProbe, NativeLegacySecret } from './native-adapters';

export interface NativePorts {
  readonly backend: 'native' | 'fake';
  readonly platformSupported: boolean;
  readonly audio: AudioCapturePort;
  readonly calendar: CalendarProbePort;
  readonly legacySecret: LegacySecretPort;
}

export type NativePortsOptions =
  | { readonly fake: true }
  | {
      readonly fake: false;
      readonly addonPath: string;
      readonly load: (path: string) => unknown;
      readonly onError?: (error: Error) => void;
    };

/** One switch between the real addon and the fakes. VOZELLA_FAKE_NATIVE=1 selects fakes. */
export function createNativePorts(options: NativePortsOptions): NativePorts {
  if (options.fake) {
    return {
      backend: 'fake',
      platformSupported: true,
      audio: new FakeAudioCapture(),
      calendar: new FakeCalendarProbe(),
      legacySecret: new FakeLegacySecret(),
    };
  }
  const addon = loadNativeAddon(options.addonPath, options.load);
  return {
    backend: 'native',
    platformSupported: addon.platformSupported(),
    audio: new NativeAudioCapture(addon, options.onError),
    calendar: new NativeCalendarProbe(addon),
    legacySecret: new NativeLegacySecret(addon),
  };
}
