import {
  audioPreviewLevel,
  audioRecordingLevel,
  audioRecordingNotice,
  audioSourcesChanged,
  type AudioRpcCall,
  type CaptureSourcesDto,
  type MicrophoneChoiceDto,
  type MicrophoneDeviceDto,
  type MicrophoneOptionDto,
  type RecordingNoticeDto,
  type SourcePickerStateDto,
} from '@vozella/contracts';
import {
  buildCaptureSources,
  buildMicrophoneOptions,
  pcm16ToFloat,
  RecordSourcePicker,
  rememberAppPatch,
  rememberMicrophonePatch,
  rememberSystemAudioPatch,
  restoreApp,
  restoreMicrophone,
  selectMicrophoneAfterReload,
  type ActiveAudioApp,
  type Logger,
  type ProcessDetails,
  type SettingsStore,
} from '@vozella/core';
import type { Broadcast } from '../ipc/library-handlers';
import type { AudioPushEvent } from '../workers/audio-worker-host';

/** The slice of AudioWorkerHost the controller uses. */
export interface AudioHostLike {
  call<T = unknown>(call: AudioRpcCall, timeoutMs?: number): Promise<T>;
  onPush(listener: (event: AudioPushEvent) => void): () => void;
}

/** Port: repeated work on a timer. Adapter: setInterval. */
export interface Scheduler {
  every(ms: number, task: () => void): () => void;
}

/** A mixed recording frame as the transcription module receives it. */
export interface RecordingFrame {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export interface AudioControllerDeps {
  readonly host: AudioHostLike;
  readonly settings: SettingsStore;
  readonly broadcast: Broadcast;
  readonly logger: Logger;
  readonly scheduler: Scheduler;
}

/** Spec 3.1.2 */
export const POLL_TICK_MS = 150;
export const FULL_REFRESH_EVERY_TICKS = 10;

/**
 * Main-process owner of audio capture. The recording module calls `startRecording`,
 * `pause`, `resume` and `stop` with a path it allocated; the pages talk to the picker, the
 * microphone list and the idle preview through IPC. State lives here, the pages draw it.
 */
export class AudioController {
  private readonly picker = new RecordSourcePicker();
  private stopPolling: (() => void) | undefined;
  private generation = 0;
  private tick = 0;
  private busy = false;
  private firstRefreshDone = false;
  private recording = false;
  private takeNotices: RecordingNoticeDto[] = [];
  private collecting = false;
  private readonly frameListeners = new Set<(frame: RecordingFrame) => void>();
  private readonly off: () => void;

  constructor(private readonly deps: AudioControllerDeps) {
    this.off = deps.host.onPush((event) => {
      this.onPush(event);
    });
  }

  dispose(): void {
    this.stopSources();
    this.off();
  }

  // Microphones -------------------------------------------------------------------------

  async loadMicrophones(
    userChoice: MicrophoneChoiceDto | null,
  ): Promise<{ options: MicrophoneOptionDto[]; selected: MicrophoneChoiceDto }> {
    let devices: MicrophoneDeviceDto[] = [];
    try {
      devices = await this.deps.host.call<MicrophoneDeviceDto[]>({ method: 'listMicrophones' });
    } catch (error) {
      // Any failure gives an empty list: only None and System default remain.
      this.deps.logger.warn('could not list microphones', { error: String(error) });
    }
    const options = buildMicrophoneOptions(devices);
    const settings = await this.deps.settings.load().catch(() => undefined);
    const remembered = settings
      ? restoreMicrophone(
          settings,
          devices.map((d) => d.id),
        )
      : { kind: 'SystemDefault' as const, deviceId: null };
    return { options, selected: selectMicrophoneAfterReload(options, userChoice, remembered) };
  }

  /** A saving failure is ignored: a locked settings file must not break picking. */
  async rememberMicrophone(choice: MicrophoneChoiceDto): Promise<boolean> {
    return this.save(rememberMicrophonePatch(choice));
  }

  startPreview(deviceId: string | null): void {
    void this.deps.host.call({ method: 'previewStart', deviceId }).catch((error: unknown) => {
      this.deps.logger.warn('microphone preview did not start', { error: String(error) });
    });
  }

  stopPreview(): void {
    void this.deps.host.call({ method: 'previewStop' }).catch(() => undefined);
  }

  // Meeting-audio picker ----------------------------------------------------------------

  get pickerState(): SourcePickerStateDto {
    return this.picker.state;
  }

  async startSources(): Promise<SourcePickerStateDto> {
    this.stopSources();
    const generation = ++this.generation;
    this.tick = 0;
    this.firstRefreshDone = false;
    this.picker.beginPolling();
    await this.refresh(generation, true);
    if (generation === this.generation) {
      this.stopPolling = this.deps.scheduler.every(POLL_TICK_MS, () => {
        void this.onTick(generation);
      });
    }
    return this.picker.state;
  }

  stopSources(): void {
    this.generation += 1;
    this.stopPolling?.();
    this.stopPolling = undefined;
    this.picker.endPolling();
  }

  async select(processId: number | null): Promise<SourcePickerStateDto> {
    if (this.picker.select(processId)) {
      this.publish();
      const app = this.picker.selectedApp;
      await this.save(
        app === null ? rememberSystemAudioPatch() : rememberAppPatch(app.exePath, app.friendlyName),
      );
    }
    return this.picker.state;
  }

  dismissSuggestion(processId: number): SourcePickerStateDto {
    this.picker.dismissSuggestion(processId);
    return this.picker.state;
  }

  closeFallback(): SourcePickerStateDto {
    this.picker.closeFallback();
    return this.picker.state;
  }

  // Recording ---------------------------------------------------------------------------

  /** Subscribes to the mixed stream (16 kHz mono float32, 200 ms). Returns the unsubscribe. */
  onRecordingFrame(listener: (frame: RecordingFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /**
   * Starts the recording at `path` with the user's microphone choice. A selected app that is
   * gone falls back to all system audio (the picker state then carries the message).
   */
  async startRecording(path: string, microphone: MicrophoneChoiceDto): Promise<CaptureSourcesDto> {
    this.takeNotices = [];
    this.collecting = true;
    this.stopSources();
    this.stopPreview();
    const target = await this.resolveTarget();
    const sources = buildCaptureSources(microphone, target);
    this.publish();
    try {
      await this.deps.host.call({ method: 'recordStart', path, sources }, 40_000);
    } catch (error) {
      this.collecting = false;
      this.takeNotices = [];
      throw error;
    }
    this.recording = true;
    return sources;
  }

  async pause(): Promise<void> {
    await this.deps.host.call({ method: 'recordPause' });
  }

  async resume(): Promise<void> {
    await this.deps.host.call({ method: 'recordResume' });
  }

  async stop(): Promise<void> {
    try {
      await this.deps.host.call({ method: 'recordStop' }, 60_000);
    } finally {
      this.recording = false;
      this.collecting = false;
      this.takeNotices = [];
    }
  }

  /** Notices of the running take, so a page opened later can still act on them. */
  get pendingNotices(): readonly RecordingNoticeDto[] {
    return this.takeNotices;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  // Import ------------------------------------------------------------------------------

  async importAudio(source: string, destination: string): Promise<void> {
    this.stopPreview();
    await this.deps.host.call({ method: 'importAudio', source, destination }, 0);
  }

  cancelImport(): void {
    void this.deps.host.call({ method: 'importCancel' }).catch(() => undefined);
  }

  // Internals ---------------------------------------------------------------------------

  private async resolveTarget(): Promise<number | null> {
    const app = this.picker.selectedApp;
    if (!app) return null;
    let details: ProcessDetails | null = null;
    try {
      details = await this.deps.host.call<ProcessDetails | null>({
        method: 'getProcess',
        processId: app.processId,
      });
    } catch {
      // Cannot tell: trust the selection, the capture itself reports a dead target.
      return app.processId;
    }
    return this.picker.resolveRecordingTarget({
      getProcess: (pid) => (pid === app.processId ? details : null),
      getVersionInfo: () => null,
    });
  }

  private async onTick(generation: number): Promise<void> {
    if (this.busy || generation !== this.generation) return;
    this.busy = true;
    try {
      this.tick += 1;
      await this.refresh(generation, this.tick % FULL_REFRESH_EVERY_TICKS === 0);
    } catch {
      // Meters are best effort: any error ends the loop silently.
      if (generation === this.generation) this.stopSources();
    } finally {
      this.busy = false;
    }
  }

  private async refresh(generation: number, full: boolean): Promise<void> {
    if (full) {
      const apps = await this.deps.host.call<ActiveAudioApp[]>({ method: 'appsRefresh' });
      if (generation !== this.generation) return;
      let restore: ((active: readonly ActiveAudioApp[]) => ActiveAudioApp | null) | undefined;
      if (!this.firstRefreshDone) {
        this.firstRefreshDone = true;
        // A settings read error leaves all system audio selected.
        const settings = await this.deps.settings.load().catch(() => undefined);
        if (generation !== this.generation) return;
        if (settings) restore = (active) => restoreApp(settings, active);
      }
      this.picker.applyRefresh(apps, restore);
    } else {
      const peaks = await this.deps.host.call<[number, number][]>({ method: 'appsPeaks' });
      if (generation !== this.generation) return;
      this.picker.applyPeaks(new Map(peaks));
    }
    this.publish();
  }

  private notice(notice: RecordingNoticeDto): void {
    if (this.collecting) this.takeNotices.push(notice);
    this.deps.broadcast(audioRecordingNotice, notice);
  }

  private publish(): void {
    this.deps.broadcast(audioSourcesChanged, this.picker.state);
  }

  private async save(patch: Parameters<SettingsStore['update']>[0]): Promise<boolean> {
    try {
      await this.deps.settings.update(patch);
      return true;
    } catch (error) {
      this.deps.logger.warn('could not save the audio choice', { error: String(error) });
      return false;
    }
  }

  private onPush(event: AudioPushEvent): void {
    switch (event.type) {
      case 'preview-level':
        this.deps.broadcast(audioPreviewLevel, { level: clampPercent(event.level) });
        break;
      case 'recording-level':
        this.deps.broadcast(audioRecordingLevel, { level: clampPercent(event.level) });
        break;
      case 'recording-frame': {
        if (this.frameListeners.size === 0) break;
        const frame = toFrame(event.pcm);
        for (const listener of [...this.frameListeners]) listener(frame);
        break;
      }
      case 'source-lost':
        this.notice({ kind: 'source-lost', source: event.source, remaining: event.remaining });
        break;
      case 'output-failed':
        this.notice({ kind: 'output-failed', message: event.message });
        break;
      case 'faulted':
        this.notice({ kind: 'faulted', message: event.message });
        break;
    }
  }
}

function clampPercent(level: number): number {
  return Math.min(100, Math.max(0, level));
}

function toFrame(pcm: Uint8Array): RecordingFrame {
  return { samples: pcm16ToFloat(pcm), sampleRate: 16_000 };
}
