import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';

/**
 * Transcription channels (module: transcription). The pages read the engine state, install and
 * remove the engine and its speaker model, change the two settings the module owns, and run
 * re-transcription. Starting and stopping a live session or an offline pass belongs to the
 * recording module in the main process, which calls the transcription controller directly.
 */

const empty = z.object({}).strict();

export const asrBackendSchema = z.enum(['cpu', 'cuda']);

/** What is being downloaded, in the order the plan runs. The page words it in its language. */
export const installStageSchema = z.enum([
  'runtime-cuda',
  'runtime-cpu',
  'runtime-cpu-fallback',
  'model',
  'speaker-model',
]);
export type InstallStageDto = z.infer<typeof installStageSchema>;

export const installProgressSchema = z.object({
  stage: installStageSchema,
  percent: z.number().min(0).max(100),
  stepIndex: z.number().int().min(0),
  stepCount: z.number().int().min(1),
});
export type InstallProgressDto = z.infer<typeof installProgressSchema>;

export const engineStatusSchema = z.object({
  /** The model and a runtime are on disk. The speaker model is not part of it. */
  ready: z.boolean(),
  modelInstalled: z.boolean(),
  runtimes: z.object({ cpu: z.boolean(), cuda: z.boolean() }),
  speakerModelInstalled: z.boolean(),
  expectedBackend: asrBackendSchema,
  /** Null until a recognizer has been created in this run. */
  usage: z
    .object({
      backend: asrBackendSchema,
      /** The raw message of the CUDA failure when the CPU was used instead. */
      fallbackReason: z.string().nullable(),
      diarization: z.enum(['off', 'on', 'model-missing']),
    })
    .nullable(),
  /** Percent of the last live session's audio that was skipped; null until one has stopped. */
  liveDroppedPercent: z.number().nullable(),
  liveEnabled: z.boolean(),
  speakerLabelsEnabled: z.boolean(),
  /** Resolved code of the transcription language. */
  language: z.string(),
  /** The running download, or null. */
  installing: installProgressSchema.nullable(),
});
export type EngineStatusDto = z.infer<typeof engineStatusSchema>;

export const transcriptionGetStatus = defineRequest('transcription.getStatus', {
  input: empty,
  output: engineStatusSchema,
});

/** Failures are values: the page shows `message` as it is (the dialog's "Download failed"). */
export const installOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready') }),
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('failed'), message: z.string() }),
]);
export type InstallOutcomeDto = z.infer<typeof installOutcomeSchema>;

/**
 * Downloads what the engine is missing and answers when it is ready. The Record gate and the
 * Settings button both use it. A second call while one runs shares the first.
 */
export const transcriptionEnsureEngine = defineRequest('transcription.ensureEngine', {
  input: empty,
  output: installOutcomeSchema,
});

export const transcriptionCancelInstall = defineRequest('transcription.cancelInstall', {
  input: empty,
  output: z.object({ cancelled: z.boolean() }),
});

export const transcriptionDeleteEngine = defineRequest('transcription.deleteEngine', {
  input: empty,
  output: z.object({ outcome: z.enum(['Deleted', 'RuntimeInUse', 'Incomplete']) }),
});

export const transcriptionSetLiveEnabled = defineRequest('transcription.setLiveEnabled', {
  input: z.object({ enabled: z.boolean() }),
  output: z.object({ saved: z.boolean() }),
});

/**
 * Turning it on without the speaker model downloads the model first. If that fails the setting
 * stays off and `message` says why (B7).
 */
export const transcriptionSetSpeakerLabels = defineRequest('transcription.setSpeakerLabels', {
  input: z.object({ enabled: z.boolean() }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), enabled: z.boolean() }),
    z.object({ status: z.literal('cancelled') }),
    z.object({ status: z.literal('failed'), message: z.string() }),
  ]),
});

export const transcriptionDownloadSpeakerModel = defineRequest(
  'transcription.downloadSpeakerModel',
  { input: empty, output: installOutcomeSchema },
);

/** Removes the speaker model and turns the setting off, so the page never claims labels it cannot make. */
export const transcriptionDeleteSpeakerModel = defineRequest('transcription.deleteSpeakerModel', {
  input: empty,
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('deleted') }),
    z.object({ status: z.literal('failed'), message: z.string() }),
  ]),
});

// ------------------------------------------------------------ re-transcription

export const retranscriptionStateSchema = z.object({
  isRunning: z.boolean(),
  meetingId: z.string().nullable(),
  status: z.string(),
});
export type RetranscriptionStateDto = z.infer<typeof retranscriptionStateSchema>;

export const retranscriptionResultSchema = z.object({
  meetingId: z.string(),
  outcome: z.enum(['Completed', 'TranscriptOnly', 'SummaryFailed', 'Cancelled', 'Failed']),
  message: z.string().nullable(),
});
export type RetranscriptionResultDto = z.infer<typeof retranscriptionResultSchema>;

export const retranscriptionAvailability = defineRequest('retranscription.availability', {
  input: z.object({ meetingId: z.string().min(1) }),
  output: z.object({ availability: z.enum(['Available', 'NoAudio', 'Busy']) }),
});

/** Resolves when the run has finished; `started` is false when another run is going. */
export const retranscriptionStart = defineRequest('retranscription.start', {
  input: z.object({ meetingId: z.string().min(1) }),
  output: z.object({
    started: z.boolean(),
    reason: z.enum(['NoAudio', 'Busy', 'AlreadyRunning', 'NotFound']).nullable(),
  }),
});

export const retranscriptionCancel = defineRequest('retranscription.cancel', {
  input: empty,
  output: z.object({ cancelled: z.literal(true) }),
});

export const retranscriptionGetState = defineRequest('retranscription.getState', {
  input: empty,
  output: retranscriptionStateSchema,
});

// ------------------------------------------------------------------- events

export const transcriptionStatusChanged = defineEvent('transcription.statusChanged', {
  payload: engineStatusSchema,
});

export const transcriptionInstallProgress = defineEvent('transcription.installProgress', {
  payload: installProgressSchema,
});

/** The live transcript while recording. `committedText` changing means a new line. */
export const transcriptionLiveUpdate = defineEvent('transcription.liveUpdate', {
  payload: z.object({ displayText: z.string(), committedText: z.string() }),
});

export const retranscriptionStateChanged = defineEvent('retranscription.stateChanged', {
  payload: retranscriptionStateSchema,
});

export const retranscriptionFinished = defineEvent('retranscription.finished', {
  payload: retranscriptionResultSchema,
});
