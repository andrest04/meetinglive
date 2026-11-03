/** Word timing from the engine. Times are milliseconds from the start of the audio. */
export interface AsrWord {
  readonly startMs: number;
  readonly endMs: number;
  /** 1-based speaker id when diarization ran, 0 when untagged. */
  readonly speakerTag: number;
  readonly text: string | null;
}

/** One result read from a stream and already copied out of the engine (spec 4.3). */
export interface AsrResult {
  readonly isFinal: boolean;
  readonly transcript: string;
  readonly audioProcessedSeconds: number;
  readonly words: readonly AsrWord[];
}

/** Right-context of the encoder. Live is 3 frames (320 ms); offline is 13 frames (1.12 s). */
export type AsrLatencyProfile = 'live' | 'offline';

/** Frames of 80 ms. Only 0, 1, 3, 6 and 13 are values the model supports. */
export const SUPPORTED_RIGHT_CONTEXT_FRAMES: readonly number[] = [0, 1, 3, 6, 13];

export function rightContextFrames(profile: AsrLatencyProfile): number {
  return profile === 'live' ? 3 : 13;
}

/** Sortformer geometry in 80 ms frames. Zero means the library default; left -1 is "default". */
export interface SortformerGeometry {
  readonly chunkFrames: number;
  readonly rightContextFrames: number;
  readonly leftContextFrames: number;
  readonly fifoFrames: number;
  readonly speakerCacheFrames: number;
  readonly updatePeriodFrames: number;
}

/** Library defaults, about 1.6 s of input. Used by the live pass. */
export const STREAMING_GEOMETRY: SortformerGeometry = {
  chunkFrames: 0,
  rightContextFrames: 0,
  leftContextFrames: -1,
  fifoFrames: 0,
  speakerCacheFrames: 0,
  updatePeriodFrames: 0,
};

/** NVIDIA very-high-latency profile (30.4 s input buffer). Used by the offline pass. */
export const MEETING_GEOMETRY: SortformerGeometry = {
  chunkFrames: 340,
  rightContextFrames: 40,
  leftContextFrames: -1,
  fifoFrames: 40,
  speakerCacheFrames: 188,
  updatePeriodFrames: 300,
};

export type AsrBackend = 'cpu' | 'cuda';

/** What the factory needs from the engine to build a recognizer (spec 3.5). */
export interface RecognizerSettings {
  readonly modelPath: string;
  /** Folder with `nemo_speech_asr_c.dll` and its siblings. */
  readonly binDirectory: string;
  /** 0 for CUDA, -1 for CPU. */
  readonly gpu: number;
  readonly diarizationModelPath: string | null;
  readonly geometry: SortformerGeometry;
  readonly latency: AsrLatencyProfile;
}

export interface StreamOptions {
  /** Engine locale (`es-US`) or `auto`. */
  readonly language: string;
  readonly interimResults: boolean;
  readonly diarization: boolean;
}

/** The engine as core sees it. The adapter lives in another process; every call can fail. */
export interface AsrEngine {
  createRecognizer(settings: RecognizerSettings): Promise<AsrRecognizer>;
}

export interface AsrRecognizer {
  startStream(options: StreamOptions): Promise<AsrStream>;
  dispose(): Promise<void>;
}

/** Spec 3.5: no `finish` here on purpose. Closing a stream with finish aborts the process. */
export interface AsrStream {
  push(samples: Float32Array, sampleRate: number): Promise<void>;
  /** Drains every result available now, each already copied and released. */
  pullAvailable(): Promise<readonly AsrResult[]>;
  dispose(): Promise<void>;
}
