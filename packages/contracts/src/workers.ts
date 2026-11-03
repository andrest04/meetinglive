import { z } from 'zod';

/** Messages between main and the audio utilityProcess. Validated on both sides. */

export const audioSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mic') }),
  z.object({ kind: z.literal('system') }),
  z.object({
    kind: z.literal('process'),
    pid: z.number().int().positive(),
    includeTree: z.boolean().default(true),
  }),
]);

/** The capture request of the audio-capture module (spec 4.3). Core re-checks its rules. */
export const captureSourcesSchema = z.object({
  captureMicrophone: z.boolean(),
  microphoneDeviceId: z.string().nullable(),
  output: z.enum(['SystemLoopback', 'ProcessTree']),
  processId: z.number().int().min(0),
});
export type CaptureSourcesDto = z.infer<typeof captureSourcesSchema>;

export const microphoneDeviceSchema = z.object({ id: z.string(), name: z.string() });
export type MicrophoneDeviceDto = z.infer<typeof microphoneDeviceSchema>;

export const activeAudioAppSchema = z.object({
  processId: z.number().int(),
  exePath: z.string().nullable(),
  friendlyName: z.string(),
  isBrowser: z.boolean(),
  isKnownMeetingApp: z.boolean(),
  peak: z.number(),
});
export type ActiveAudioAppDto = z.infer<typeof activeAudioAppSchema>;

/** Calls that expect one answer from the audio worker. */
export const audioRpcCallSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('recordStart'),
    path: z.string().min(1),
    sources: captureSourcesSchema,
  }),
  z.object({ method: z.literal('recordPause') }),
  z.object({ method: z.literal('recordResume') }),
  z.object({ method: z.literal('recordStop') }),
  z.object({ method: z.literal('previewStart'), deviceId: z.string().nullable() }),
  z.object({ method: z.literal('previewStop') }),
  z.object({ method: z.literal('listMicrophones') }),
  z.object({ method: z.literal('appsRefresh') }),
  z.object({ method: z.literal('appsPeaks') }),
  z.object({ method: z.literal('getProcess'), processId: z.number().int().min(1) }),
  z.object({
    method: z.literal('importAudio'),
    source: z.string().min(1),
    destination: z.string().min(1),
  }),
  z.object({ method: z.literal('importCancel') }),
]);
export type AudioRpcCall = z.infer<typeof audioRpcCallSchema>;

export const audioWorkerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('rpc'), id: z.number().int(), call: audioRpcCallSchema }),
  z.object({ type: z.literal('start'), source: audioSourceSchema }),
  z.object({ type: z.literal('stop') }),
  /** End the process (used by the host on app quit). `stop` only ends a capture. */
  z.object({ type: z.literal('shutdown') }),
]);
export type AudioWorkerCommand = z.infer<typeof audioWorkerCommandSchema>;

export const captureStatsSchema = z.object({
  frames: z.number(),
  realSamples: z.number(),
  synthesizedSamples: z.number(),
  packets: z.number(),
  silentFlagPackets: z.number(),
  discontinuities: z.number(),
});

export const audioWorkerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pong'),
    backend: z.enum(['native', 'fake']),
    platformSupported: z.boolean(),
  }),
  z.object({ type: z.literal('started') }),
  /** 16 kHz mono PCM16 little-endian, 20 ms per frame. */
  z.object({
    type: z.literal('frame'),
    pcm: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
    tsMs: z.number(),
    synthesized: z.boolean(),
  }),
  z.object({ type: z.literal('stopped'), stats: captureStatsSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
  /** `ok` false carries `message` (and `code` for failures the UI maps to its own words). */
  z.object({
    type: z.literal('rpc-result'),
    id: z.number().int(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    message: z.string().optional(),
    code: z.string().optional(),
  }),
  /** The mixed recording stream: PCM16 little-endian, 16 kHz mono, 200 ms per frame. */
  z.object({
    type: z.literal('recording-frame'),
    pcm: z.custom<Uint8Array>((v) => v instanceof Uint8Array),
  }),
  /** Microphone level of the running recording, 0..100, about ten per second. */
  z.object({ type: z.literal('recording-level'), level: z.number() }),
  z.object({
    type: z.literal('source-lost'),
    source: z.enum(['Microphone', 'Output']),
    remaining: z.number().int(),
    message: z.string(),
  }),
  z.object({ type: z.literal('output-failed'), message: z.string() }),
  z.object({ type: z.literal('faulted'), message: z.string() }),
  /** Idle microphone preview level, 0..100. */
  z.object({ type: z.literal('preview-level'), level: z.number() }),
]);
export type AudioWorkerEvent = z.infer<typeof audioWorkerEventSchema>;

export const asrGeometrySchema = z.object({
  chunkFrames: z.number().int(),
  rightContextFrames: z.number().int(),
  leftContextFrames: z.number().int(),
  fifoFrames: z.number().int(),
  speakerCacheFrames: z.number().int(),
  updatePeriodFrames: z.number().int(),
});

export const asrRecognizerSettingsSchema = z.object({
  modelPath: z.string().min(1),
  binDirectory: z.string().min(1),
  /** 0 for CUDA, -1 for CPU. */
  gpu: z.number().int(),
  diarizationModelPath: z.string().nullable(),
  geometry: asrGeometrySchema,
  latency: z.enum(['live', 'offline']),
});

export const asrStreamOptionsSchema = z.object({
  language: z.string(),
  interimResults: z.boolean(),
  diarization: z.boolean(),
});

export const asrWordSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  speakerTag: z.number().int(),
  text: z.string().nullable(),
});

export const asrResultSchema = z.object({
  isFinal: z.boolean(),
  transcript: z.string(),
  audioProcessedSeconds: z.number(),
  words: z.array(asrWordSchema),
});
export type AsrResultDto = z.infer<typeof asrResultSchema>;
export const asrResultsSchema = z.array(asrResultSchema);

/** Calls that expect one answer from the ASR worker. The worker owns every native handle. */
export const asrRpcCallSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('createRecognizer'),
    recognizerId: z.string().min(1),
    settings: asrRecognizerSettingsSchema,
  }),
  z.object({
    method: z.literal('startStream'),
    streamId: z.string().min(1),
    recognizerId: z.string().min(1),
    options: asrStreamOptionsSchema,
  }),
  z.object({
    method: z.literal('push'),
    streamId: z.string().min(1),
    /** Mono float32. */
    samples: z.custom<Float32Array>((value) => value instanceof Float32Array),
    sampleRate: z.number().int(),
  }),
  z.object({ method: z.literal('pull'), streamId: z.string().min(1) }),
  z.object({ method: z.literal('disposeStream'), streamId: z.string().min(1) }),
  z.object({ method: z.literal('disposeRecognizer'), recognizerId: z.string().min(1) }),
]);
export type AsrRpcCall = z.infer<typeof asrRpcCallSchema>;

export const asrWorkerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  /** Loads the engine library from a folder and reports its version. Used by the self test. */
  z.object({ type: z.literal('load'), binDir: z.string().min(1) }),
  z.object({ type: z.literal('rpc'), id: z.number().int(), call: asrRpcCallSchema }),
  z.object({ type: z.literal('shutdown') }),
]);
export type AsrWorkerCommand = z.infer<typeof asrWorkerCommandSchema>;

export const asrWorkerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong'), koffi: z.string().nullable() }),
  z.object({ type: z.literal('loaded'), version: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('rpc-result'),
    id: z.number().int(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    message: z.string().optional(),
  }),
]);
export type AsrWorkerEvent = z.infer<typeof asrWorkerEventSchema>;
