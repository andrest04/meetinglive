import type {
  AsrEngine,
  AsrRecognizer,
  AsrResult,
  AsrStream,
  RecognizerSettings,
  StreamOptions,
} from './asr-types';
import type { AudioFrameReader, AudioFrameSource, EngineModelStore, RuntimeStore } from './ports';
import type { AsrBackend } from './asr-types';
import type { CancelSignal } from '../cancel';
import type { PinnedFile } from './engine-catalog';

/** Doubles for the engine and its stores. Used by the tests of core, platform and the desktop app. */

export interface FakeStreamScript {
  /** Results returned by `pullAvailable` after each push, in order; later pushes get none. */
  readonly afterPush?: readonly (readonly AsrResult[])[];
  /** Makes `push` wait until this promise settles (a slow backend). */
  readonly pushGate?: () => Promise<void>;
  readonly pushError?: Error;
}

export class FakeAsrStream implements AsrStream {
  pushes: { samples: Float32Array; sampleRate: number }[] = [];
  disposed = 0;
  finishCalled = false;
  private index = 0;

  constructor(
    readonly options: StreamOptions,
    private readonly script: FakeStreamScript,
  ) {}

  async push(samples: Float32Array, sampleRate: number): Promise<void> {
    await this.script.pushGate?.();
    if (this.script.pushError) throw this.script.pushError;
    this.pushes.push({ samples, sampleRate });
  }

  pullAvailable(): Promise<readonly AsrResult[]> {
    const results = this.script.afterPush?.[this.index] ?? [];
    this.index += 1;
    return Promise.resolve(results);
  }

  dispose(): Promise<void> {
    this.disposed += 1;
    return Promise.resolve();
  }
}

export class FakeAsrRecognizer implements AsrRecognizer {
  streams: FakeAsrStream[] = [];
  disposed = 0;

  constructor(
    readonly settings: RecognizerSettings,
    private readonly script: FakeStreamScript,
    private readonly startError: Error | null = null,
  ) {}

  startStream(options: StreamOptions): Promise<AsrStream> {
    if (this.startError) return Promise.reject(this.startError);
    const stream = new FakeAsrStream(options, this.script);
    this.streams.push(stream);
    return Promise.resolve(stream);
  }

  dispose(): Promise<void> {
    this.disposed += 1;
    return Promise.resolve();
  }
}

export class FakeAsrEngine implements AsrEngine {
  recognizers: FakeAsrRecognizer[] = [];
  /** Backends (by gpu id) whose creation fails with this message. */
  failGpu = new Map<number, string>();
  script: FakeStreamScript = {};
  startError: Error | null = null;

  createRecognizer(settings: RecognizerSettings): Promise<AsrRecognizer> {
    const failure = this.failGpu.get(settings.gpu);
    if (failure !== undefined) return Promise.reject(new Error(failure));
    const recognizer = new FakeAsrRecognizer(settings, this.script, this.startError);
    this.recognizers.push(recognizer);
    return Promise.resolve(recognizer);
  }
}

export class FakeRuntimeStore implements RuntimeStore {
  ready = new Set<AsrBackend>();
  downloads: AsrBackend[] = [];
  deleteError: Error | null = null;
  deleted = 0;

  isReady(backend: AsrBackend): boolean {
    return this.ready.has(backend);
  }
  binDirectory(backend: AsrBackend): string {
    if (!this.ready.has(backend))
      throw new Error(`The NeMo-Speech ${backend} runtime is not installed.`);
    return `C:/runtime/${backend}/bin`;
  }
  download(backend: AsrBackend, onProgress: (percent: number) => void): Promise<void> {
    this.downloads.push(backend);
    onProgress(50);
    this.ready.add(backend);
    return Promise.resolve();
  }
  delete(): Promise<void> {
    if (this.deleteError) return Promise.reject(this.deleteError);
    this.deleted += 1;
    this.ready.clear();
    return Promise.resolve();
  }
}

export class FakeModelStore implements EngineModelStore {
  model = false;
  diarization = false;
  downloads: string[] = [];
  deleteModelError: Error | null = null;
  deleteDiarError: Error | null = null;

  modelPath = (): string => 'C:/models/asr.gguf';
  diarizationModelPath = (): string => 'C:/models/diar.gguf';
  isModelDownloaded = (): boolean => this.model;
  isDiarizationModelDownloaded = (): boolean => this.diarization;

  download(
    file: PinnedFile,
    onProgress: (percent: number) => void,
    _cancel?: CancelSignal,
  ): Promise<void> {
    this.downloads.push(file.fileName);
    onProgress(100);
    if (file.fileName.startsWith('diar')) this.diarization = true;
    else this.model = true;
    return Promise.resolve();
  }
  deleteModel(): Promise<void> {
    if (this.deleteModelError) return Promise.reject(this.deleteModelError);
    this.model = false;
    return Promise.resolve();
  }
  deleteDiarizationModel(): Promise<void> {
    if (this.deleteDiarError) return Promise.reject(this.deleteDiarError);
    this.diarization = false;
    return Promise.resolve();
  }
}

/** A WAV made of samples already in memory. */
export class FakeAudioReader implements AudioFrameReader {
  opened: string[] = [];
  closed = 0;

  constructor(
    private readonly samples: Float32Array,
    private readonly sampleRate = 16_000,
    private readonly channels = 1,
    private readonly failOpen: Error | null = null,
  ) {}

  open(path: string): AudioFrameSource {
    this.opened.push(path);
    if (this.failOpen) throw this.failOpen;
    let offset = 0;
    const closeCount = (): void => {
      this.closed += 1;
    };
    const samples = this.samples;
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      durationMs: (samples.length / this.channels / this.sampleRate) * 1000,
      read(buffer: Float32Array): number {
        const count = Math.min(buffer.length, samples.length - offset);
        buffer.set(samples.subarray(offset, offset + count));
        offset += count;
        return count;
      },
      close(): void {
        closeCount();
      },
    };
  }
}
