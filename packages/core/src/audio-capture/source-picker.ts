import { compareNames, type ActiveAudioApp, type ProcessInfoProvider } from './active-audio-apps';
import type { AppSettings } from '../library/settings';

/** The meeting-audio picker: merge, still-running check, suggestion, memory (spec 2.4, 2.6). */

export interface ActiveAppEntry {
  readonly app: ActiveAudioApp;
  readonly isAvailable: boolean;
}

/** Spec 3.4.4. Keeps a selected app visible after it stops playing, dimmed, in name order. */
export function mergeActiveApps(
  active: readonly ActiveAudioApp[],
  selected: ActiveAudioApp | null,
): ActiveAppEntry[] {
  const entries: ActiveAppEntry[] = active.map((app) => ({ app, isAvailable: true }));
  if (selected && !active.some((app) => app.processId === selected.processId)) {
    const at = entries.findIndex(
      (e) => compareNames(e.app.friendlyName, selected.friendlyName) > 0,
    );
    const gone: ActiveAppEntry = { app: selected, isAvailable: false };
    if (at < 0) entries.push(gone);
    else entries.splice(at, 0, gone);
  }
  return entries;
}

/** False for a pid that is gone or now runs another image. An unreadable path is trusted. */
export function isAppStillRunning(app: ActiveAudioApp, processes: ProcessInfoProvider): boolean {
  const process = processes.getProcess(app.processId);
  if (!process) return false;
  if (app.exePath === null || process.exePath === null) return true;
  return app.exePath.toLowerCase() === process.exePath.toLowerCase();
}

/**
 * The known meeting app to suggest, or null. Only while all system audio is selected; the
 * loudest wins, ties go by name; dismissed pids are skipped.
 */
export function suggestMeetingApp(
  apps: readonly ActiveAudioApp[],
  allSystemSelected: boolean,
  dismissed: ReadonlySet<number>,
): ActiveAudioApp | null {
  if (!allSystemSelected) return null;
  const candidates = apps.filter((a) => a.isKnownMeetingApp && !dismissed.has(a.processId));
  candidates.sort((a, b) => b.peak - a.peak || compareNames(a.friendlyName, b.friendlyName));
  return candidates[0] ?? null;
}

// Remembered choices (spec 2.6) -----------------------------------------------------------

export type MicrophoneChoiceKind = 'None' | 'SystemDefault' | 'Device';

export interface MicrophoneChoice {
  readonly kind: MicrophoneChoiceKind;
  /** The endpoint id; only for `Device`. */
  readonly deviceId: string | null;
}

export const NO_MICROPHONE: MicrophoneChoice = { kind: 'None', deviceId: null };
export const SYSTEM_DEFAULT_MICROPHONE: MicrophoneChoice = {
  kind: 'SystemDefault',
  deviceId: null,
};

type RememberedFields = Pick<
  AppSettings,
  | 'recordMicrophoneKind'
  | 'recordMicrophoneDeviceId'
  | 'recordOutputKind'
  | 'recordAppExePath'
  | 'recordAppName'
  | 'selectedMicrophoneDeviceId'
>;

/** Patches for `SettingsStore.update`: every other setting is left alone. */
export function rememberMicrophonePatch(
  choice: MicrophoneChoice,
): Pick<AppSettings, 'recordMicrophoneKind' | 'recordMicrophoneDeviceId'> {
  return {
    recordMicrophoneKind: choice.kind,
    recordMicrophoneDeviceId: choice.kind === 'Device' ? choice.deviceId : null,
  };
}

export function rememberSystemAudioPatch(): Pick<
  AppSettings,
  'recordOutputKind' | 'recordAppExePath' | 'recordAppName'
> {
  return { recordOutputKind: 'System', recordAppExePath: null, recordAppName: null };
}

export function rememberAppPatch(
  exePath: string | null,
  name: string,
): Pick<AppSettings, 'recordOutputKind' | 'recordAppExePath' | 'recordAppName'> {
  return { recordOutputKind: 'App', recordAppExePath: exePath, recordAppName: name };
}

function deviceOrDefault(id: string | null, available: ReadonlySet<string>): MicrophoneChoice {
  return id !== null && id !== '' && available.has(id)
    ? { kind: 'Device', deviceId: id }
    : SYSTEM_DEFAULT_MICROPHONE;
}

/** Spec 2.6. An unplugged remembered device falls back to the system default, never None. */
export function restoreMicrophone(
  settings: RememberedFields,
  availableDeviceIds: readonly string[],
): MicrophoneChoice {
  const available = new Set(availableDeviceIds);
  const kind = settings.recordMicrophoneKind?.trim().toLowerCase();
  if (kind === 'none') return NO_MICROPHONE;
  if (kind === 'systemdefault') return SYSTEM_DEFAULT_MICROPHONE;
  if (kind === 'device') return deviceOrDefault(settings.recordMicrophoneDeviceId, available);
  // Not set, unparsable or an undefined value: the Settings microphone decides.
  return deviceOrDefault(settings.selectedMicrophoneDeviceId, available);
}

/** The active app that matches the remembered executable path, with its current pid. */
export function restoreApp(
  settings: Pick<AppSettings, 'recordOutputKind' | 'recordAppExePath'>,
  activeApps: readonly ActiveAudioApp[],
): ActiveAudioApp | null {
  if (settings.recordOutputKind?.toLowerCase() !== 'app') return null;
  const path = settings.recordAppExePath;
  if (path === null || path.trim() === '') return null;
  return (
    activeApps.find((a) => a.exePath !== null && a.exePath.toLowerCase() === path.toLowerCase()) ??
    null
  );
}
