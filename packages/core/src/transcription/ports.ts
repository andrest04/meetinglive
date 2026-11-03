import type { CancelSignal } from '../cancel';
import type { AsrBackend } from './asr-types';
import type { PinnedFile } from './engine-catalog';

export type ProgressSink = (percent: number) => void;

/** Port: the extracted NeMo-Speech runtimes on disk. Adapter: NemoSpeechRuntimeManager (platform). */
export interface RuntimeStore {
  isReady(backend: AsrBackend): boolean;
  /** Folder with the native library. Throws when the runtime is not installed. */
  binDirectory(backend: AsrBackend): string;
  download(backend: AsrBackend, onProgress: ProgressSink, cancel?: CancelSignal): Promise<void>;
  /** Throws {@link RuntimeInUseError} and removes nothing when a file is held open. */
  delete(): Promise<void>;
}

/** Port: the GGUF models. Adapter: NemotronModelStore (platform). */
export interface EngineModelStore {
  modelPath(): string;
  diarizationModelPath(): string;
  isModelDownloaded(): boolean;
  isDiarizationModelDownloaded(): boolean;
  download(file: PinnedFile, onProgress: ProgressSink, cancel?: CancelSignal): Promise<void>;
  deleteModel(): Promise<void>;
  deleteDiarizationModel(): Promise<void>;
}

/** A runtime file is open (the native library is loaded), so nothing was removed. */
export class RuntimeInUseError extends Error {
  constructor(readonly fileName: string) {
    super(`The NeMo-Speech runtime file is in use: ${fileName}`);
    this.name = 'RuntimeInUseError';
  }
}

/** The work was cancelled by the caller. */
export class TranscriptionCancelledError extends Error {
  constructor() {
    super('The transcription was cancelled.');
    this.name = 'TranscriptionCancelledError';
  }
}

export interface AudioFrameSource {
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationMs: number;
  /** Fills `buffer` with interleaved float samples; returns how many were written, 0 at the end. */
  read(buffer: Float32Array): number;
  close(): void;
}

/** Port: a WAV opened as float samples. Adapter reads files; tests give samples. */
export interface AudioFrameReader {
  /** Repairs a header a crash left with zero sizes, then opens the file. */
  open(path: string): AudioFrameSource;
}
