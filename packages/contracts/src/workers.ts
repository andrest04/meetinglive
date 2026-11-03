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

export const audioWorkerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('start'), source: audioSourceSchema }),
  z.object({ type: z.literal('stop') }),
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
    pcm: z.instanceof(Uint8Array),
    tsMs: z.number(),
    synthesized: z.boolean(),
  }),
  z.object({ type: z.literal('stopped'), stats: captureStatsSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type AudioWorkerEvent = z.infer<typeof audioWorkerEventSchema>;

export const asrWorkerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('load'), binDir: z.string().min(1) }),
  z.object({ type: z.literal('stop') }),
]);
export type AsrWorkerCommand = z.infer<typeof asrWorkerCommandSchema>;

export const asrWorkerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('pong'), koffi: z.string().nullable() }),
  z.object({ type: z.literal('loaded'), version: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type AsrWorkerEvent = z.infer<typeof asrWorkerEventSchema>;
