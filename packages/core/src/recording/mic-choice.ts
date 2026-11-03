import {
  buildMicrophoneOptions,
  sameMicrophoneOptions,
  selectMicrophoneAfterReload,
  type MicrophoneDevice,
  type MicrophoneOption,
} from '../audio-capture/record-sources';
import { restoreMicrophone, type MicrophoneChoice } from '../audio-capture/source-picker';
import type { AppSettings } from '../library/settings';

/** Microphone choice rules (spec 8, items 20-23): one entry point over the existing helpers. */

export type RememberedMicrophone = Pick<
  AppSettings,
  'recordMicrophoneKind' | 'recordMicrophoneDeviceId' | 'selectedMicrophoneDeviceId'
>;

export interface MicrophoneChoiceState {
  readonly options: readonly MicrophoneOption[];
  readonly selected: MicrophoneChoice;
}

/**
 * The list and the selection after a (re)load. `current` is what the user already picked in this
 * page visit; otherwise the remembered kind decides, then the Settings microphone, then System
 * default. A vanished device is System default, never None.
 */
export function resolveMicrophoneChoice(
  devices: readonly MicrophoneDevice[],
  settings: RememberedMicrophone,
  current: MicrophoneChoice | null = null,
): MicrophoneChoiceState {
  const options = buildMicrophoneOptions(devices);
  const ids = options.flatMap((o) =>
    o.kind === 'Device' && o.deviceId !== null ? [o.deviceId] : [],
  );
  const remembered = restoreMicrophone(
    { ...settings, recordOutputKind: null, recordAppExePath: null, recordAppName: null },
    ids,
  );
  return { options, selected: selectMicrophoneAfterReload(options, current, remembered) };
}

/** An unchanged list is not rewritten (an open dropdown stays as it is). */
export const sameMicrophoneChoices = sameMicrophoneOptions;
