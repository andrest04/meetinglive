import type { ActiveAudioApp, ProcessInfoProvider } from './active-audio-apps';
import {
  processTreeSources,
  systemLoopbackSources,
  type RecordingCaptureSources,
} from './capture-sources';
import { toMeterPercent } from './level-meter';
import {
  isAppStillRunning,
  mergeActiveApps,
  SYSTEM_DEFAULT_MICROPHONE,
  type MicrophoneChoice,
} from './source-picker';

/** State behind the Record page "Sources" card (spec 2.1 and 2.4). Pure, no I/O. */

export interface MicrophoneDevice {
  readonly id: string;
  readonly name: string;
}

export interface MicrophoneOption extends MicrophoneChoice {
  /** The endpoint friendly name; only for `Device`. */
  readonly name: string | null;
}

/** None, System default, then one option per device. Devices with an empty id are skipped. */
export function buildMicrophoneOptions(devices: readonly MicrophoneDevice[]): MicrophoneOption[] {
  return [
    { kind: 'None', deviceId: null, name: null },
    { kind: 'SystemDefault', deviceId: null, name: null },
    ...devices
      .filter((d) => d.id !== '')
      .map((d): MicrophoneOption => ({ kind: 'Device', deviceId: d.id, name: d.name })),
  ];
}

/** When a reload yields the same list the open dropdown is kept as it is. */
export function sameMicrophoneOptions(
  a: readonly MicrophoneOption[],
  b: readonly MicrophoneOption[],
): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return x.kind === y?.kind && x.deviceId === y.deviceId && x.name === y.name;
    })
  );
}

/**
 * The selection after a reload. A choice the user already made is kept; a device that
 * vanished falls back to System default, never None. Otherwise the remembered choice.
 */
export function selectMicrophoneAfterReload(
  options: readonly MicrophoneOption[],
  userChoice: MicrophoneChoice | null,
  remembered: MicrophoneChoice,
): MicrophoneChoice {
  const wanted = userChoice ?? remembered;
  if (wanted.kind !== 'Device') return wanted;
  const present = options.some((o) => o.kind === 'Device' && o.deviceId === wanted.deviceId);
  return present ? wanted : SYSTEM_DEFAULT_MICROPHONE;
}

/** The request for the capture module. A null target means all system audio. */
export function buildCaptureSources(
  microphone: MicrophoneChoice,
  targetProcessId: number | null,
): RecordingCaptureSources {
  const capture = microphone.kind !== 'None';
  const deviceId =
    microphone.kind === 'Device' && microphone.deviceId !== null && microphone.deviceId !== ''
      ? microphone.deviceId
      : null;
  return targetProcessId === null
    ? systemLoopbackSources(capture, deviceId)
    : processTreeSources(capture, deviceId, targetProcessId);
}

export interface SourceCard {
  /** Null for the fixed "All system audio" card. */
  readonly processId: number | null;
  readonly app: ActiveAudioApp | null;
  readonly isAvailable: boolean;
  /** 0..100. The system card has no meter, an unavailable card reads 0. */
  readonly level: number;
}

export interface SourcePickerState {
  readonly cards: readonly SourceCard[];
  /** Null means all system audio. */
  readonly selectedProcessId: number | null;
  /** True when no app card is available: the picker shows its hint. */
  readonly noAppsPlaying: boolean;
  /** Set when the selected app was gone at Record time. */
  readonly fallbackAppName: string | null;
}

const SYSTEM_CARD: SourceCard = { processId: null, app: null, isAvailable: true, level: 0 };

export class RecordSourcePicker {
  private apps: readonly ActiveAudioApp[] = [];
  private selected: ActiveAudioApp | null = null;
  private levels = new Map<number, number>();
  private userTouched = false;
  private restorePending = false;
  private fallbackAppName: string | null = null;

  /** Called when the poller starts: arms the one-time restore of the remembered app. */
  beginPolling(): void {
    this.restorePending = true;
  }

  /** Meters go quiet when polling stops. */
  endPolling(): void {
    this.levels = new Map();
  }

  /**
   * A full refresh. `restore` runs once per `beginPolling`, only if the user has not picked
   * a card and no app is selected.
   */
  applyRefresh(
    apps: readonly ActiveAudioApp[],
    restore?: (active: readonly ActiveAudioApp[]) => ActiveAudioApp | null,
  ): void {
    this.apps = apps;
    if (this.restorePending) {
      this.restorePending = false;
      if (!this.userTouched && this.selected === null && restore) {
        const restored = restore(apps);
        if (restored) this.selected = restored;
      }
    }
    // A selected app that is still playing takes its fresh data (same pid).
    const live = this.selected
      ? apps.find((a) => a.processId === this.selected?.processId)
      : undefined;
    if (live) this.selected = live;
    this.levels = new Map(apps.map((a) => [a.processId, toMeterPercent(a.peak)]));
  }

  /** Peak-only tick. Skips the system card and unavailable cards. */
  applyPeaks(peaks: ReadonlyMap<number, number>): void {
    const next = new Map<number, number>();
    for (const app of this.apps)
      next.set(app.processId, toMeterPercent(peaks.get(app.processId) ?? 0));
    this.levels = next;
  }

  /** A user pick. Selecting what is already selected changes nothing and returns false. */
  select(processId: number | null): boolean {
    if (processId === (this.selected?.processId ?? null)) return false;
    this.userTouched = true;
    this.fallbackAppName = null;
    this.selected =
      processId === null
        ? null
        : (this.apps.find((a) => a.processId === processId) ?? this.selected);
    return true;
  }

  /** Spec 2.4. A gone app falls back to all system audio with a message. */
  resolveRecordingTarget(processes: ProcessInfoProvider): number | null {
    const app = this.selected;
    if (!app) return null;
    if (isAppStillRunning(app, processes)) {
      this.fallbackAppName = null;
      return app.processId;
    }
    this.fallbackAppName = app.friendlyName;
    this.selected = null;
    return null;
  }

  closeFallback(): void {
    this.fallbackAppName = null;
  }

  get selectedApp(): ActiveAudioApp | null {
    return this.selected;
  }

  get state(): SourcePickerState {
    const entries = mergeActiveApps(this.apps, this.selected);
    const cards: SourceCard[] = [
      SYSTEM_CARD,
      ...entries.map((e): SourceCard => ({
        processId: e.app.processId,
        app: e.app,
        isAvailable: e.isAvailable,
        level: e.isAvailable ? (this.levels.get(e.app.processId) ?? 0) : 0,
      })),
    ];
    return {
      cards,
      selectedProcessId: this.selected?.processId ?? null,
      noAppsPlaying: !entries.some((e) => e.isAvailable),
      fallbackAppName: this.fallbackAppName,
    };
  }
}
