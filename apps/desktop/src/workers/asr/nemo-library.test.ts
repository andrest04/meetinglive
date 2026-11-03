import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { MEETING_GEOMETRY, STREAMING_GEOMETRY } from '@vozella/core';
import { loadNemoLibrary, structSizes, type Koffi } from './nemo-library';

type Impl = (...args: unknown[]) => unknown;
type Cfg = Parameters<ReturnType<typeof loadNemoLibrary>['createRecognizer']>[0];

/** A recording koffi: no DLL, no native code. Functions are looked up by C name. */
function makeKoffi(impls: Record<string, Impl>) {
  const calls: { name: string; args: unknown[] }[] = [];
  const events: string[] = [];
  const koffi = {
    opaque: (name: string) => ({ opaque: name }),
    struct: (name: string, def: object) => ({ struct: name, def }),
    pointer: (t: unknown) => ({ pointer: t }),
    sizeof: (t: { struct?: string }) => 100 + (t.struct?.length ?? 0),
    load: (file: string) => {
      events.push(`load ${file}`);
      return {
        func: (signature: string) => {
          const name = /(nemo_speech_asr_\w+|SetDllDirectoryW)\s*\(/.exec(signature)?.[1] ?? '';
          return (...args: unknown[]) => {
            calls.push({ name, args });
            if (name === 'SetDllDirectoryW') events.push(`dll-dir ${String(args[0])}`);
            return impls[name]?.(...args);
          };
        },
      };
    },
  };
  return { koffi: koffi as unknown as Koffi, calls, events };
}

const settle = (impls: Record<string, Impl>): Record<string, Impl> => ({
  nemo_speech_asr_version: () => '0.3.0',
  nemo_speech_asr_last_error: () => null,
  ...impls,
});

const config = (over: Partial<Cfg> = {}): Cfg => ({
  modelPath: 'C:/m/nemotron.gguf',
  gpu: -1,
  diarizationModelPath: null,
  geometry: STREAMING_GEOMETRY,
  rnntRightContext: 3,
  ...over,
});

const okCreate = (): Record<string, Impl> => ({
  nemo_speech_asr_create: (_cfg, out) => {
    (out as unknown[])[0] = {};
    return 0;
  },
});

describe('struct layout on the running ABI', () => {
  const win = process.platform === 'win32';
  const real = () => createRequire(import.meta.url)('koffi') as Koffi;

  it.skipIf(!win)('matches the v0.3.0 header sizes (spec item 101)', () => {
    expect(structSizes(real())).toEqual({
      backend: 16,
      model: 24,
      streaming: 24,
      endpointing: 16,
      diar: 40,
      recognizer: 88,
      options: 72,
    });
  });

  it.skipIf(!win)('places the fields at the header offsets', () => {
    const koffi = real();
    structSizes(koffi);
    const offsetof = (koffi as unknown as { offsetof: (t: string, f: string) => number }).offsetof;
    expect(offsetof('nemo_speech_asr_recognizer_config', 'backend')).toBe(8);
    expect(offsetof('nemo_speech_asr_recognizer_config', 'diar')).toBe(64);
    expect(offsetof('nemo_speech_asr_recognizer_config', 'salm')).toBe(80);
    expect(offsetof('nemo_speech_asr_streaming_config', 'rnnt_right_context')).toBe(20);
    expect(offsetof('nemo_speech_asr_diar_config', 'spkcache_frames')).toBe(32);
    expect(offsetof('nemo_speech_asr_recognition_options', 'language_code')).toBe(16);
    expect(offsetof('nemo_speech_asr_recognition_options', 'max_alternatives')).toBe(56);
  });
});

describe('loadNemoLibrary with a recording koffi', () => {
  it('sets the DLL search path before the engine DLL is loaded', () => {
    const { koffi, events } = makeKoffi(settle({}));
    loadNemoLibrary(koffi, 'C:/engine/bin');
    const dirIndex = events.findIndex((e) => e.startsWith('dll-dir '));
    const dllIndex = events.findIndex((e) => e.includes('nemo_speech_asr_c.dll'));
    expect(dirIndex).toBeGreaterThanOrEqual(0);
    expect(dirIndex).toBeLessThan(dllIndex);
  });

  it('builds the create config with the fixed streaming and endpointing values', () => {
    const { koffi, calls } = makeKoffi(settle(okCreate()));
    loadNemoLibrary(koffi, 'C:/engine/bin').createRecognizer(
      config({ gpu: 0, rnntRightContext: 13 }),
    );
    const cfg = calls.find((c) => c.name === 'nemo_speech_asr_create')?.args[0] as Record<
      string,
      Record<string, unknown> | null
    >;
    expect(cfg.streaming).toMatchObject({
      chunk_size: 0.16,
      ctc_left_padding: 1.92,
      ctc_right_padding: 1.92,
      rnnt_right_context: 13,
    });
    expect(cfg.endpointing).toMatchObject({
      enable: true,
      vad_based: false,
      stop_history_eou_ms: 800,
    });
    expect(cfg.backend).toMatchObject({ gpu: 0 });
    expect(cfg.model).toMatchObject({ path: 'C:/m/nemotron.gguf', name: null });
    expect(cfg.diar).toBeNull();
    expect(cfg.salm).toBeNull();
  });

  it('maps each geometry value to its own diarization field', () => {
    const { koffi, calls } = makeKoffi(settle(okCreate()));
    const lib = loadNemoLibrary(koffi, 'C:/engine/bin');
    lib.createRecognizer(
      config({ diarizationModelPath: 'C:/m/sortformer.gguf', geometry: MEETING_GEOMETRY }),
    );
    lib.createRecognizer(
      config({ diarizationModelPath: 'C:/m/sortformer.gguf', geometry: STREAMING_GEOMETRY }),
    );
    const creates = calls
      .filter((c) => c.name === 'nemo_speech_asr_create')
      .map((c) => (c.args[0] as { diar: Record<string, unknown> }).diar);
    expect(creates[0]).toMatchObject({
      model_path: 'C:/m/sortformer.gguf',
      chunk_frames: 340,
      right_context_frames: 40,
      left_context_frames: -1,
      fifo_frames: 40,
      spkcache_frames: 188,
      update_period_frames: 300,
    });
    expect(creates[1]).toMatchObject({
      chunk_frames: 0,
      right_context_frames: 0,
      left_context_frames: -1,
      fifo_frames: 0,
      spkcache_frames: 0,
      update_period_frames: 0,
    });
  });

  it('passes the recognition options flags', () => {
    const { koffi, calls } = makeKoffi(
      settle({
        nemo_speech_asr_streaming_recognize: (_r, _o, out) => {
          (out as unknown[])[0] = {};
          return 0;
        },
      }),
    );
    loadNemoLibrary(koffi, 'C:/engine/bin').startStream(
      {},
      { language: 'es', interimResults: true, diarization: true },
    );
    expect(
      calls.find((c) => c.name === 'nemo_speech_asr_streaming_recognize')?.args[1],
    ).toMatchObject({
      language_code: 'es',
      interim_results: true,
      enable_word_time_offsets: true,
      enable_automatic_punctuation: true,
      verbatim_transcripts: false,
      profanity_filter: false,
      max_alternatives: 1,
      enable_speaker_diarization: true,
      max_speaker_count: 0,
    });
  });

  describe('results', () => {
    interface W {
      t: string | null;
      s: number;
      e: number;
      k: number;
    }
    const at = (i: unknown) => i as number;
    const resultImpls = (words: W[]): Record<string, Impl> => ({
      nemo_speech_asr_stream_next: (_s, out) => {
        (out as unknown[])[0] = { result: true };
        return 0;
      },
      nemo_speech_asr_result_is_final: () => 1,
      nemo_speech_asr_result_audio_processed: () => 2.5,
      nemo_speech_asr_result_transcript: () => 'hola mundo',
      nemo_speech_asr_result_word_count: () => words.length,
      nemo_speech_asr_result_word_text: (_r, _a, i) => words[at(i)]?.t,
      nemo_speech_asr_result_word_start_time: (_r, _a, i) => words[at(i)]?.s,
      nemo_speech_asr_result_word_end_time: (_r, _a, i) => words[at(i)]?.e,
      nemo_speech_asr_result_word_speaker_tag: (_r, _a, i) => words[at(i)]?.k,
    });

    it('copies every field, then destroys the result once, last', () => {
      const { koffi, calls } = makeKoffi(
        settle(
          resultImpls([
            { t: 'hola', s: 0, e: 400, k: 0 },
            { t: 'mundo', s: 480, e: 900, k: 1 },
          ]),
        ),
      );
      expect(loadNemoLibrary(koffi, 'C:/engine/bin').next({})).toEqual({
        isFinal: true,
        audioProcessedSeconds: 2.5,
        transcript: 'hola mundo',
        words: [
          { text: 'hola', startMs: 0, endMs: 400, speakerTag: 0 },
          { text: 'mundo', startMs: 480, endMs: 900, speakerTag: 1 },
        ],
      });
      const names = calls.map((c) => c.name);
      expect(names.filter((n) => n === 'nemo_speech_asr_result_destroy')).toHaveLength(1);
      expect(names.at(-1)).toBe('nemo_speech_asr_result_destroy');
    });

    it('destroys the result even when a read throws', () => {
      const impls = resultImpls([{ t: 'hola', s: 0, e: 1, k: 0 }]);
      impls.nemo_speech_asr_result_word_text = () => {
        throw new Error('read failed');
      };
      const { koffi, calls } = makeKoffi(settle(impls));
      expect(() => loadNemoLibrary(koffi, 'C:/engine/bin').next({})).toThrow('read failed');
      expect(calls.filter((c) => c.name === 'nemo_speech_asr_result_destroy')).toHaveLength(1);
    });

    it('returns null when no result is ready', () => {
      const { koffi, calls } = makeKoffi(settle({ nemo_speech_asr_stream_next: () => 0 }));
      expect(loadNemoLibrary(koffi, 'C:/engine/bin').next({})).toBeNull();
      expect(calls.some((c) => c.name === 'nemo_speech_asr_result_destroy')).toBe(false);
    });
  });

  describe('failures', () => {
    it('formats a failing status with the last native error', () => {
      const { koffi } = makeKoffi(
        settle({
          nemo_speech_asr_stream_push_f32: () => 7,
          nemo_speech_asr_last_error: () => 'bad sample rate',
        }),
      );
      const lib = loadNemoLibrary(koffi, 'C:/engine/bin');
      expect(() => {
        lib.pushF32({}, new Float32Array(2), 16000);
      }).toThrow('nemo_speech_asr_stream_push_f32 failed: bad sample rate');
    });

    it('falls back to "unknown error" when the engine has no message', () => {
      const { koffi } = makeKoffi(settle({ nemo_speech_asr_create: () => 3 }));
      expect(() => loadNemoLibrary(koffi, 'C:/engine/bin').createRecognizer(config())).toThrow(
        'nemo_speech_asr_create failed: unknown error',
      );
    });

    it('fails when create or start report success with a null handle', () => {
      const { koffi } = makeKoffi(
        settle({ nemo_speech_asr_create: () => 0, nemo_speech_asr_streaming_recognize: () => 0 }),
      );
      const lib = loadNemoLibrary(koffi, 'C:/engine/bin');
      expect(() => lib.createRecognizer(config())).toThrow(
        'nemo_speech_asr_create failed: the engine returned no handle',
      );
      expect(() =>
        lib.startStream({}, { language: 'es', interimResults: false, diarization: false }),
      ).toThrow('nemo_speech_asr_streaming_recognize failed: the engine returned no handle');
    });
  });
});
