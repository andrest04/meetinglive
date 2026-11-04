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
export const audioSourcesCloseFallback = defineRequest('audio.sources.closeFallback', {
  input: empty,
  output: sourcePickerStateSchema,
});

/** Starts the idle level of a microphone. Never fails; levels arrive on `audio.preview.level`. */
export const previewOwnerSchema = z.enum(['record', 'settings']);

export const audioPreviewStart = defineRequest('audio.preview.start', {
  /** The page that starts the meter owns it; the default is Settings (B-32). */
  input: z.object({ deviceId: z.string().nullable(), owner: previewOwnerSchema.optional() }),
  output: z.object({ started: z.literal(true) }),
});
export const audioPreviewStop = defineRequest('audio.preview.stop', {
  /** A stop from a page that does not own the meter does nothing (B-32). */
  input: z.object({ owner: previewOwnerSchema.optional() }),
  output: z.object({ stopped: z.literal(true) }),
});

/**
 * Starts a take. The page names the title and the microphone; the main process allocates the file
 * in the Inbox, so the page never chooses a path. A failure carries the worker's code when it has
 * one, so the page can use its own words for it.
 */
export const audioRecordingStart = defineRequest('audio.recording.start', {
  input: z.object({ title: z.string(), microphone: microphoneChoiceSchema }),
  output: z.discriminatedUnion('started', [
    z.object({ started: z.literal(true), recordedAtMs: z.number() }),
    z.object({ started: z.literal(false), code: z.string().nullable(), message: z.string() }),
  ]),
});
/**
 * Where the take stands in main. The Record page asks when it opens, so a take that kept running
 * while the user visited another page can still be paused, resumed and stopped.
 */
const recordingNoticeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('source-lost'),
    source: z.enum(['Microphone', 'Output']),
    remaining: z.number().int(),
  }),
  z.object({ kind: z.literal('output-failed'), message: z.string() }),
  z.object({ kind: z.literal('faulted'), message: z.string() }),
]);

export type RecordingNoticeDto = z.infer<typeof recordingNoticeSchema>;

export const audioRecordingState = defineRequest('audio.recording.state', {
  input: empty,
  output: z.object({
    phase: z.enum(['idle', 'starting', 'recording', 'paused', 'stopping', 'importing']),
    /** Notices raised since the take started, for a page that was not mounted to hear them. */
    notices: z.array(recordingNoticeSchema).default([]),
  }),
});
export const audioRecordingPause = defineRequest('audio.recording.pause', {
  input: empty,
  output: z.object({ paused: z.boolean() }),
});
export const audioRecordingResume = defineRequest('audio.recording.resume', {
  input: empty,
  output: z.object({ resumed: z.boolean() }),
});
/** Ends the take. A stop error still reports what is known about the file. */
export const audioRecordingStop = defineRequest('audio.recording.stop', {
  input: empty,
  output: z.object({
    path: z.string().nullable(),
    recordedAtMs: z.number().nullable(),
    /** Time spent paused, for the live transcript clock. */
    pausedSeconds: z.number(),
    /** The failure to show, or null. */
    error: z.string().nullable(),
  }),
});

/**
 * Converts the file picked with `audio.import.pickFile` into a take in the Inbox. The path comes
 * from the main process's own memory of the pick, never from the page.
 */
export const audioImportRun = defineRequest('audio.import.run', {
  input: z.object({ title: z.string() }),
  output: z.discriminatedUnion('imported', [
    z.object({
      imported: z.literal(true),
      path: z.string(),
      recordedAtMs: z.number(),
      /** recordedAt plus the length of the converted audio. */
      endedAtMs: z.number(),
      durationSeconds: z.number(),
    }),
    z.object({ imported: z.literal(false), message: z.string() }),
  ]),
});

/** The icon of an application's executable as a data URL, or null (spec 131). */
export const audioAppIcon = defineRequest('audio.apps.icon', {
  input: z.object({ exePath: z.string().min(1) }),
  output: z.object({ dataUrl: z.string().nullable() }),
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
  payload: recordingNoticeSchema,
});
