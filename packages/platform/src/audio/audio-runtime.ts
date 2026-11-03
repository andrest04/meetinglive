import fs from 'node:fs';
import path from 'node:path';
import {
  ActiveAudioAppService,
  assertProcessLoopbackSupported,
  AudioCaptureService,
  AudioImportService,
  MicrophoneLevelPreview,
  type ActiveAudioApp,
  type CancelSignal,
  type MicrophoneDevice,
} from '@vozella/core';
import type { NativePorts } from '../native/create-native-ports';
import { SystemPumpClock } from './system-pump-clock';
import { repairWavFile, WavFileWriter } from './wav-files';

export interface AudioRuntimeOptions {
  readonly ports: NativePorts;
  /** The main process of the app. Its helper processes are left out of the app list. */
  readonly ownProcessId: number;
  /** Idle microphone level, 0..1. */
  readonly onPreviewLevel: (level: number) => void;
}

/** The audio worker's services, wired to real files and the native ports. */
export interface AudioRuntime {
  readonly recording: AudioCaptureService;
  readonly preview: MicrophoneLevelPreview;
  readonly apps: ActiveAudioAppService;
  listMicrophones(): MicrophoneDevice[];
  refreshApps(): ActiveAudioApp[];
  importAudio(source: string, destination: string, cancel?: CancelSignal): Promise<void>;
}

export function createAudioRuntime(options: AudioRuntimeOptions): AudioRuntime {
  const { ports } = options;
  const recording = new AudioCaptureService({
    sources: ports.audio,
    clock: new SystemPumpClock(),
    createWriter: (file) => new WavFileWriter(file),
    removeFile: (file) => {
      fs.rmSync(file, { force: true });
    },
    repairWav: (file) => {
      repairWavFile(file);
    },
    preflight: (sources) => {
      if (sources.output === 'ProcessTree') {
        assertProcessLoopbackSupported(ports.osBuild.windowsBuild());
      }
    },
  });
  const importer = new AudioImportService({
    fileExists: (file) => fs.existsSync(file),
    ensureParentDirectory: (file) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    },
    openDecoder: (file) => ports.openDecoder(file),
    createWriter: (file) => new WavFileWriter(file),
    removeFile: (file) => {
      fs.rmSync(file, { force: true });
    },
    yieldToEventLoop: () => new Promise<void>((resolve) => setImmediate(resolve)),
  });
  const apps = new ActiveAudioAppService(ports.sessions, ports.processes, options.ownProcessId);
  return {
    recording,
    preview: new MicrophoneLevelPreview(ports.audio, options.onPreviewLevel),
    apps,
    listMicrophones: () => {
      try {
        return ports.microphones.list();
      } catch {
        // Any failure gives an empty list: only None and System default remain.
        return [];
      }
    },
    refreshApps: () => apps.refresh(),
    importAudio: (source, destination, cancel) =>
      importer.convertToNemotronWav(source, destination, cancel),
  };
}
