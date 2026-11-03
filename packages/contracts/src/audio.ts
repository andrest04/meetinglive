import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';
import { activeAudioAppSchema } from './workers';

/**
 * Audio capture channels (module: audio-capture). The renderer never names a file to write:
 * starting, pausing and stopping a recording belong to the recording module in the main
 * process, which owns the path. These channels carry what the pages show and choose.
 */

export const microphoneChoiceSchema = z.object({
  kind: z.enum(['None', 'SystemDefault', 'Device']),
  /** The OS endpoint id; only for `Device`. */
  deviceId: z.string().nullable(),
});
export type MicrophoneChoiceDto = z.infer<typeof microphoneChoiceSchema>;

export const microphoneOptionSchema = microphoneChoiceSchema.extend({
  /** The endpoint friendly name; only for `Device`. */
  name: z.string().nullable(),
});
export type MicrophoneOptionDto = z.infer<typeof microphoneOptionSchema>;

export const sourceCardSchema = z.object({
  /** Null for the fixed "All system audio" card. */
  processId: z.number().int().nullable(),
  app: activeAudioAppSchema.nullable(),
  isAvailable: z.boolean(),
  /** 0..100. */
  level: z.number(),
});
export type SourceCardDto = z.infer<typeof sourceCardSchema>;

export const sourcePickerStateSchema = z.object({
  cards: z.array(sourceCardSchema).readonly(),
  /** Null means all system audio. */
  selectedProcessId: z.number().int().nullable(),
  noAppsPlaying: z.boolean(),
  suggestion: activeAudioAppSchema.nullable(),
  /** The name of the app that was gone at Record time; the page shows the fallback bar. */
  fallbackAppName: z.string().nullable(),
});
export type SourcePickerStateDto = z.infer<typeof sourcePickerStateSchema>;

const empty = z.object({}).strict();

/**
 * Lists the capture endpoints and picks the selection: the user's choice if they made one
 * (a vanished device falls back to System default), otherwise the remembered choice.
 */
export const audioMicrophonesLoad = defineRequest('audio.microphones.load', {
  input: z.object({ userChoice: microphoneChoiceSchema.nullable() }),
  output: z.object({
    options: z.array(microphoneOptionSchema),
    selected: microphoneChoiceSchema,
  }),
});

export const audioMicrophonesRemember = defineRequest('audio.microphones.remember', {
  input: z.object({ choice: microphoneChoiceSchema }),
  output: z.object({ saved: z.boolean() }),
});

/** Starts the poller of apps and meters. It runs until `audio.sources.stop`. */
export const audioSourcesStart = defineRequest('audio.sources.start', {
  input: empty,
  output: sourcePickerStateSchema,
});
export const audioSourcesStop = defineRequest('audio.sources.stop', {
  input: empty,
  output: z.object({ stopped: z.literal(true) }),
});
/** A user pick; it is remembered. Null selects all system audio. */
export const audioSourcesSelect = defineRequest('audio.sources.select', {
  input: z.object({ processId: z.number().int().nullable() }),
  output: sourcePickerStateSchema,
});
export const audioSourcesDismissSuggestion = defineRequest('audio.sources.dismissSuggestion', {
  input: z.object({ processId: z.number().int() }),
  output: sourcePickerStateSchema,
});
export const audioSourcesCloseFallback = defineRequest('audio.sources.closeFallback', {
  input: empty,
  output: sourcePickerStateSchema,
});

/** Starts the idle level of a microphone. Never fails; levels arrive on `audio.preview.level`. */
export const audioPreviewStart = defineRequest('audio.preview.start', {
  input: z.object({ deviceId: z.string().nullable() }),
  output: z.object({ started: z.literal(true) }),
});
export const audioPreviewStop = defineRequest('audio.preview.stop', {
  input: empty,
  output: z.object({ stopped: z.literal(true) }),
});

/** Opens the file picker for the import. Null when the user cancels. */
export const audioImportPickFile = defineRequest('audio.import.pickFile', {
  input: empty,
  output: z
    .object({
      path: z.string(),
      /** The file's last-write time, or now when it cannot be read. */
      recordedAtMs: z.number(),
    })
    .nullable(),
});

export const audioSourcesChanged = defineEvent('audio.sources.changed', {
  payload: sourcePickerStateSchema,
});

/** Idle microphone level, 0..100, about ten per second. */
export const audioPreviewLevel = defineEvent('audio.preview.level', {
  payload: z.object({ level: z.number() }),
});

/** Microphone level of the running recording, 0..100. */
export const audioRecordingLevel = defineEvent('audio.recording.level', {
  payload: z.object({ level: z.number() }),
});

/** A source was lost, the meeting audio failed, or the writer faulted (spec 2.3.3). */
export const audioRecordingNotice = defineEvent('audio.recording.notice', {
  payload: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('source-lost'),
      source: z.enum(['Microphone', 'Output']),
      remaining: z.number().int(),
    }),
    z.object({ kind: z.literal('output-failed'), message: z.string() }),
    z.object({ kind: z.literal('faulted'), message: z.string() }),
  ]),
});
