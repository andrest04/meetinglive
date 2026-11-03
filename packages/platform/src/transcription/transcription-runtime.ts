import {
  AsrBackendStatus,
  LiveTranscriptionService,
  NemoSpeechRecognizerFactory,
  TranscriptionEngineInstaller,
  TranscriptionService,
  type AsrEngine,
  type AudioFrameReader,
  type HardwareProfile,
  type Logger,
} from '@vozella/core';
import { NemotronModelStore, type ModelStoreOptions } from './model-store';
import { NemoSpeechRuntimeManager, type RuntimeManagerOptions } from './runtime-manager';
import { WavFrameReader } from './wav-frame-reader';

export interface TranscriptionRuntimeOptions {
  readonly transcriptionModelsDirectory: string;
  readonly nemoSpeechDirectory: string;
  /** The speech engine. In the app it is the proxy to the ASR utility process. */
  readonly engine: AsrEngine;
  readonly hardware: () => Promise<Pick<HardwareProfile, 'gpuName'>>;
  readonly logger: Logger;
  readonly audio?: AudioFrameReader;
  /** Test seams for the stores. */
  readonly models?: Partial<ModelStoreOptions>;
  readonly runtimes?: Partial<RuntimeManagerOptions>;
}

/** Everything the transcription module builds from paths and an engine (spec 3.4 to 3.11). */
export class TranscriptionRuntime {
  readonly status = new AsrBackendStatus();
  readonly models: NemotronModelStore;
  readonly runtimes: NemoSpeechRuntimeManager;
  readonly installer: TranscriptionEngineInstaller;
  readonly factory: NemoSpeechRecognizerFactory;
  readonly offline: TranscriptionService;
  readonly live: LiveTranscriptionService;

  constructor(options: TranscriptionRuntimeOptions) {
    this.models = new NemotronModelStore({
      directory: options.transcriptionModelsDirectory,
      ...options.models,
    });
    this.runtimes = new NemoSpeechRuntimeManager({
      root: options.nemoSpeechDirectory,
      ...options.runtimes,
    });
    this.installer = new TranscriptionEngineInstaller({
      models: this.models,
      runtimes: this.runtimes,
      hardware: options.hardware,
    });
    this.factory = new NemoSpeechRecognizerFactory({
      engine: options.engine,
      models: this.models,
      runtimes: this.runtimes,
      hardware: options.hardware,
      status: this.status,
    });
    this.offline = new TranscriptionService({
      factory: this.factory,
      audio: options.audio ?? new WavFrameReader(),
    });
    this.live = new LiveTranscriptionService({
      factory: this.factory,
      status: this.status,
      onError: (error) => {
        options.logger.warn('live transcription error', { error: String(error) });
      },
    });
  }
}
