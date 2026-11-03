import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';
import { microphoneChoiceSchema } from './audio';

/**
 * Recording channels (module: recording). Main owns the take from Record to the saved summary:
 * the page names the title, the destination and the sources, and draws the state it receives. The
 * page never names a file and never holds the clock.
 */

const empty = z.object({}).strict();

/** A catalog key with its values and a typed severity (B-12): the page never parses text. */
export const recordingMessageSchema = z.object({
  key: z.string(),
  args: z.array(z.string()),
  severity: z.enum(['info', 'warning', 'error']),
});
export type RecordingMessageDto = z.infer<typeof recordingMessageSchema>;

export const recordingPhaseSchema = z.enum([
  'Idle',
  'Preparing',
  'Recording',
  'Stopping',
  'Processing',
]);
export type RecordingPhaseDto = z.infer<typeof recordingPhaseSchema>;

/**
 * Everything the Record page draws except the transcript text, which has its own event so a long
 * meeting does not travel with every status change. The elapsed time is `elapsedMs` as of
 * `elapsedAsOfMs`; the page adds the time since then only while `isTicking` (pauses excluded).
 */
export const recordingStateSchema = z.object({
  phase: recordingPhaseSchema,
  isRecording: z.boolean(),
  isPaused: z.boolean(),
  isProcessing: z.boolean(),
  elapsedMs: z.number(),
  elapsedAsOfMs: z.number(),
  isTicking: z.boolean(),
  /** The status line: shown in order, joined with a space. */
  status: z.array(recordingMessageSchema),
  /** 0..100. Zero while paused (B-15). */
  micLevel: z.number(),
  /** The hard failure of the take first, then the soft warning. */
  captureNotices: z.array(recordingMessageSchema),
  /** The meeting the take writes to; null while idle. */
  meetingId: z.string().nullable(),
  title: z.string(),
  recordedAtMs: z.number().nullable(),
  highlightCount: z.number().int(),
  /** The session notes main holds (the page edits them with `recording.setNotes`). */
  notes: z.string(),
  /** The first save failed and the take can be processed again from the same audio. */
  canRetry: z.boolean(),
  lastMeeting: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type RecordingStateDto = z.infer<typeof recordingStateSchema>;

export const recordingGetState = defineRequest('recording.getState', {
  input: empty,
  /** The state plus the transcript text the canvas shows (highlights applied). */
  output: recordingStateSchema.extend({ liveText: z.string() }),
});

/**
 * Starts a take. `microphone` null and `processId` left out mean "the page never loaded the
 * sources": main restores the remembered microphone and app (B-23), so a pill or toast start
 * records what the user chose last. `processId` null is all system audio.
 */
export const recordingStart = defineRequest('recording.start', {
  input: z.object({
    title: z.string(),
    folderId: z.string().nullable(),
    microphone: microphoneChoiceSchema.nullable(),
    processId: z.number().int().nullable().optional(),
    appName: z.string().nullable(),
  }),
  output: z.discriminatedUnion('started', [
    z.object({
      started: z.literal(true),
      meetingId: z.string(),
      recordedAtMs: z.number(),
    }),
    z.object({
      started: z.literal(false),
      /** `busy`: a take or a run holds the session. `not-ready`: the setup gate refused. */
      reason: z.enum(['busy', 'not-ready', 'failed']),
      message: recordingMessageSchema.nullable(),
    }),
  ]),
});

export const recordingPause = defineRequest('recording.pause', {
  input: empty,
  output: z.object({ paused: z.boolean() }),
});
export const recordingResume = defineRequest('recording.resume', {
  input: empty,
  output: z.object({ resumed: z.boolean() }),
});
/** Ends the take and starts the pipeline. A second call joins the stop already running. */
export const recordingStop = defineRequest('recording.stop', {
  input: empty,
  output: z.object({ stopped: z.boolean() }),
});
/** The page confirms first. Nothing is saved and a linked meeting is untouched. */
export const recordingDiscard = defineRequest('recording.discard', {
  input: empty,
  output: z.object({ discarded: z.boolean() }),
});
/** Marks this moment in WAV time (pauses excluded). */
export const recordingHighlight = defineRequest('recording.highlight', {
  input: empty,
  output: z.object({ marked: z.boolean(), elapsedMs: z.number() }),
});
export const recordingSetNotes = defineRequest('recording.setNotes', {
  input: z.object({ text: z.string() }),
  output: z.object({ accepted: z.boolean() }),
});
/**
 * Cancels the foreground run. With a meeting id it cancels the summary that runs in the
 * background after the hand-off instead (B-21).
 */
export const recordingCancelProcessing = defineRequest('recording.cancelProcessing', {
  input: z.object({ meetingId: z.string().nullable() }),
  output: z.object({ cancelled: z.boolean() }),
});
/** Runs the pipeline again on the audio of a take whose first save failed (B-11). */
export const recordingRetryProcessing = defineRequest('recording.retryProcessing', {
  input: empty,
  output: z.object({ started: z.boolean() }),
});

export const recordingStateChanged = defineEvent('recording.state', {
  payload: recordingStateSchema,
});

/** The canvas text with the highlight stars applied. Sent when it changes. */
export const recordingLiveText = defineEvent('recording.liveText', {
  payload: z.object({ text: z.string() }),
});
