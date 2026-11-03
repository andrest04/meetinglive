import path from 'node:path';
import type { AsrResultDto } from '@vozella/contracts';
import type * as KoffiModule from 'koffi';

/** The koffi module. Passed in, so tests and the worker choose how it is loaded. */
export type Koffi = typeof KoffiModule;

/** Opaque native handle. Only this file looks inside. */
export type NativeHandle = object;

export interface RecognizerConfigDto {
  readonly modelPath: string;
  /** 0 for CUDA, -1 for CPU. */
  readonly gpu: number;
  readonly diarizationModelPath: string | null;
  readonly geometry: {
    readonly chunkFrames: number;
    readonly rightContextFrames: number;
    readonly leftContextFrames: number;
    readonly fifoFrames: number;
    readonly speakerCacheFrames: number;
    readonly updatePeriodFrames: number;
  };
  /** Encoder right context in 80 ms frames: 3 for live, 13 for offline. */
  readonly rnntRightContext: number;
}

export interface StreamConfigDto {
  readonly language: string;
  readonly interimResults: boolean;
  readonly diarization: boolean;
}

/** The C ABI of NeMo-Speech.cpp v0.3.0 as the worker uses it (spec 3.5, gaps section 2). */
export interface NemoLibrary {
  readonly version: string;
  createRecognizer(config: RecognizerConfigDto): NativeHandle;
  destroyRecognizer(recognizer: NativeHandle): void;
  startStream(recognizer: NativeHandle, config: StreamConfigDto): NativeHandle;
  pushF32(stream: NativeHandle, samples: Float32Array, sampleRate: number): void;
  /** One result copied out of the engine and released at once, or null when none is ready. */
  next(stream: NativeHandle): AsrResultDto | null;
  closeStream(stream: NativeHandle): void;
}

const STATUS_OK = 0;
const ENGINE_DLL = 'nemo_speech_asr_c.dll';

/** Types are global to koffi, so they are created once per process. */
interface Types {
  readonly backend: unknown;
  readonly model: unknown;
  readonly streaming: unknown;
  readonly endpointing: unknown;
  readonly diar: unknown;
  readonly recognizer: unknown;
  readonly options: unknown;
}

const typeCache = new WeakMap<object, Types>();

function typesOf(koffi: Koffi): Types {
  const cached = typeCache.get(koffi);
  if (cached) return cached;
  koffi.opaque('nemo_speech_asr_recognizer');
  koffi.opaque('nemo_speech_asr_stream');
  koffi.opaque('nemo_speech_asr_result');
  const backend = koffi.struct('nemo_speech_asr_backend_config', {
    size: 'size_t',
    gpu: 'int32',
  });
  const model = koffi.struct('nemo_speech_asr_model_config', {
    size: 'size_t',
    path: 'str',
    name: 'str',
  });
  const streaming = koffi.struct('nemo_speech_asr_streaming_config', {
    size: 'size_t',
    chunk_size: 'float',
    ctc_left_padding: 'float',
    ctc_right_padding: 'float',
    rnnt_right_context: 'int32',
  });
  const endpointing = koffi.struct('nemo_speech_asr_endpointing_config', {
    size: 'size_t',
    enable: 'bool',
    vad_based: 'bool',
    stop_history_eou_ms: 'int32',
  });
  const diar = koffi.struct('nemo_speech_asr_diar_config', {
    size: 'size_t',
    model_path: 'str',
    chunk_frames: 'int32',
    right_context_frames: 'int32',
    left_context_frames: 'int32',
    fifo_frames: 'int32',
    spkcache_frames: 'int32',
    update_period_frames: 'int32',
  });
  // Subsystems that stay NULL are void pointers. v0.3.0 appended `salm`: 88 bytes.
  const recognizer = koffi.struct('nemo_speech_asr_recognizer_config', {
    size: 'size_t',
    backend: koffi.pointer(backend),
    model: koffi.pointer(model),
    streaming: koffi.pointer(streaming),
    decoder: 'void *',
    vad: 'void *',
    endpointing: koffi.pointer(endpointing),
    postproc: 'void *',
    diar: koffi.pointer(diar),
    batching: 'void *',
    salm: 'void *',
  });
  const options = koffi.struct('nemo_speech_asr_recognition_options', {
    size: 'size_t',
    request_id: 'str',
    language_code: 'str',
    interim_results: 'bool',
    enable_word_time_offsets: 'bool',
    enable_automatic_punctuation: 'bool',
    verbatim_transcripts: 'bool',
    profanity_filter: 'bool',
    stop_history_eou_ms: 'int32',
    speech_contexts: 'void *',
    speech_context_count: 'size_t',
    max_alternatives: 'int32',
    enable_speaker_diarization: 'bool',
    max_speaker_count: 'int32',
  });
  const types: Types = { backend, model, streaming, endpointing, diar, recognizer, options };
  typeCache.set(koffi, types);
  return types;
}

/** Sizes of the structs on the running ABI, for the size tests (spec item 101). */
export function structSizes(koffi: Koffi): Record<string, number> {
  const t = typesOf(koffi);
  return {
    backend: koffi.sizeof(t.backend as never),
    model: koffi.sizeof(t.model as never),
    streaming: koffi.sizeof(t.streaming as never),
    endpointing: koffi.sizeof(t.endpointing as never),
    diar: koffi.sizeof(t.diar as never),
    recognizer: koffi.sizeof(t.recognizer as never),
    options: koffi.sizeof(t.options as never),
  };
}

/** Makes the engine's sibling DLLs (ggml, llama, cublas, the MSVC runtime) resolvable. */
export function prepareDllDirectory(koffi: Koffi, binDir: string): void {
  const resolved = path.resolve(binDir);
  const kernel32 = koffi.load('kernel32.dll');
  const setDllDirectory = kernel32.func('int __stdcall SetDllDirectoryW(const char16_t *path)');
  (setDllDirectory as (dir: string) => unknown)(resolved);
  process.env.PATH = `${resolved};${process.env.PATH ?? ''}`;
}

/**
 * Loads the library from `binDir` and binds the functions the app uses. The library is never
 * unloaded: freeing it while worker threads of the engine run aborts the process (spec 3.5).
 * `stream_finish` is bound nowhere on purpose.
 */
export function loadNemoLibrary(koffi: Koffi, binDir: string): NemoLibrary {
  const dir = path.resolve(binDir);
  prepareDllDirectory(koffi, dir);
  const lib = koffi.load(path.join(dir, ENGINE_DLL));
  const t = typesOf(koffi);

  const fn = {
    create: lib.func(
      'int nemo_speech_asr_create(const nemo_speech_asr_recognizer_config *cfg, _Out_ nemo_speech_asr_recognizer **out)',
    ),
    destroy: lib.func('void nemo_speech_asr_destroy(nemo_speech_asr_recognizer *r)'),
    streamingRecognize: lib.func(
      'int nemo_speech_asr_streaming_recognize(nemo_speech_asr_recognizer *r, const nemo_speech_asr_recognition_options *o, _Out_ nemo_speech_asr_stream **out)',
    ),
    streamPushF32: lib.func(
      'int nemo_speech_asr_stream_push_f32(nemo_speech_asr_stream *s, const float *samples, size_t n, int32 sampleRate)',
    ),
    streamNext: lib.func(
      'int nemo_speech_asr_stream_next(nemo_speech_asr_stream *s, _Out_ nemo_speech_asr_result **out)',
    ),
    streamClose: lib.func('void nemo_speech_asr_stream_close(nemo_speech_asr_stream *s)'),
    resultIsFinal: lib.func(
      'bool nemo_speech_asr_result_is_final(const nemo_speech_asr_result *r)',
    ),
    resultAudioProcessed: lib.func(
      'float nemo_speech_asr_result_audio_processed(const nemo_speech_asr_result *r)',
    ),
    resultTranscript: lib.func(
      'const char *nemo_speech_asr_result_transcript(const nemo_speech_asr_result *r, size_t alt)',
    ),
    resultWordCount: lib.func(
      'size_t nemo_speech_asr_result_word_count(const nemo_speech_asr_result *r, size_t alt)',
    ),
    resultWordText: lib.func(
      'const char *nemo_speech_asr_result_word_text(const nemo_speech_asr_result *r, size_t alt, size_t i)',
    ),
    resultWordStart: lib.func(
      'int32 nemo_speech_asr_result_word_start_time(const nemo_speech_asr_result *r, size_t alt, size_t i)',
    ),
    resultWordEnd: lib.func(
      'int32 nemo_speech_asr_result_word_end_time(const nemo_speech_asr_result *r, size_t alt, size_t i)',
    ),
    resultWordSpeaker: lib.func(
      'int32 nemo_speech_asr_result_word_speaker_tag(const nemo_speech_asr_result *r, size_t alt, size_t i)',
    ),
    resultDestroy: lib.func('void nemo_speech_asr_result_destroy(nemo_speech_asr_result *r)'),
    lastError: lib.func('const char *nemo_speech_asr_last_error()'),
    version: lib.func('const char *nemo_speech_asr_version()'),
  };

  const sizeOf = (type: unknown): number => koffi.sizeof(type as never);
  const call = (name: string, run: () => unknown): void => {
    const status = run();
    if (status !== STATUS_OK) {
      throw new Error(`${name} failed: ${String(fn.lastError() ?? 'unknown error')}`);
    }
  };

  /** Everything is copied before the handle is released (gaps section 2). */
  function readResult(result: NativeHandle): AsrResultDto {
    try {
      const count = Number(fn.resultWordCount(result, 0));
      const words: AsrResultDto['words'] = [];
      for (let i = 0; i < count; i += 1) {
        words.push({
          text: (fn.resultWordText(result, 0, i) as string | null) ?? null,
          startMs: Number(fn.resultWordStart(result, 0, i)),
          endMs: Number(fn.resultWordEnd(result, 0, i)),
          speakerTag: Number(fn.resultWordSpeaker(result, 0, i)),
        });
      }
      return {
        isFinal: Boolean(fn.resultIsFinal(result)),
        audioProcessedSeconds: Number(fn.resultAudioProcessed(result)),
        transcript: (fn.resultTranscript(result, 0) as string | null) ?? '',
        words,
      };
    } finally {
      fn.resultDestroy(result);
    }
  }

  return {
    version: String(fn.version()),

    createRecognizer(config) {
      const g = config.geometry;
      const cfg = {
        size: sizeOf(t.recognizer),
        backend: { size: sizeOf(t.backend), gpu: config.gpu },
        model: { size: sizeOf(t.model), path: config.modelPath, name: null },
        streaming: {
          size: sizeOf(t.streaming),
          chunk_size: 0.16,
          ctc_left_padding: 1.92,
          ctc_right_padding: 1.92,
          rnnt_right_context: config.rnntRightContext,
        },
        decoder: null,
        vad: null,
        // Energy based endpointing, 800 ms (spec 3.5): without it no final ever arrives.
        endpointing: {
          size: sizeOf(t.endpointing),
          enable: true,
          vad_based: false,
          stop_history_eou_ms: 800,
        },
        postproc: null,
        diar:
          config.diarizationModelPath === null
            ? null
            : {
                size: sizeOf(t.diar),
                model_path: config.diarizationModelPath,
                chunk_frames: g.chunkFrames,
                right_context_frames: g.rightContextFrames,
                left_context_frames: g.leftContextFrames,
                fifo_frames: g.fifoFrames,
                spkcache_frames: g.speakerCacheFrames,
                update_period_frames: g.updatePeriodFrames,
              },
        batching: null,
        salm: null,
      };
      const out: (NativeHandle | null)[] = [null];
      call('nemo_speech_asr_create', () => fn.create(cfg, out));
      const handle = out[0];
      if (!handle) throw new Error('nemo_speech_asr_create failed: the engine returned no handle');
      return handle;
    },

    destroyRecognizer(recognizer) {
      fn.destroy(recognizer);
    },

    startStream(recognizer, config) {
      const options = {
        size: sizeOf(t.options),
        request_id: null,
        language_code: config.language,
        interim_results: config.interimResults,
        enable_word_time_offsets: true,
        enable_automatic_punctuation: true,
        verbatim_transcripts: false,
        profanity_filter: false,
        stop_history_eou_ms: 0,
        speech_contexts: null,
        speech_context_count: 0,
        max_alternatives: 1,
        enable_speaker_diarization: config.diarization,
        max_speaker_count: 0,
      };
      const out: (NativeHandle | null)[] = [null];
      call('nemo_speech_asr_streaming_recognize', () =>
        fn.streamingRecognize(recognizer, options, out),
      );
      const handle = out[0];
      if (!handle) {
        throw new Error(
          'nemo_speech_asr_streaming_recognize failed: the engine returned no handle',
        );
      }
      return handle;
    },

    pushF32(stream, samples, sampleRate) {
      call('nemo_speech_asr_stream_push_f32', () =>
        fn.streamPushF32(stream, samples, samples.length, sampleRate),
      );
    },

    next(stream) {
      const out: (NativeHandle | null)[] = [null];
      call('nemo_speech_asr_stream_next', () => fn.streamNext(stream, out));
      return out[0] ? readResult(out[0]) : null;
    },

    closeStream(stream) {
      fn.streamClose(stream);
    },
  };
}
