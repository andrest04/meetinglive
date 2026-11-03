import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';
import { appSettingsSchema } from './library';

/**
 * Settings page channels (module: settings-i18n). The generic `settings.get` and
 * `settings.update` of the library module stay for the other modules' own fields; everything the
 * Settings page owns goes through the checked commands below.
 */

const empty = z.object({}).strict();

export const uiLanguageTagSchema = z.enum(['en-US', 'es']);
export const catalogLocaleSchema = z.enum(['en', 'es']);
export const summaryProviderSchema = z.enum(['Local', 'ClaudeCode', 'Codex', 'Xai']);
export type SummaryProviderDto = z.infer<typeof summaryProviderSchema>;
export const cliStatusSchema = z.enum(['detected', 'missing']);

export const feedbackSchema = z.object({
  key: z.literal('Xai_FeedbackModel'),
  args: z.array(z.string()).readonly(),
});
export type FeedbackDto = z.infer<typeof feedbackSchema>;

/** What a settings change did. Failures are values. */
export const commitOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('saved'),
    settings: appSettingsSchema,
    feedback: feedbackSchema.nullable(),
  }),
  z.object({ status: z.literal('ignored'), reason: z.enum(['blank', 'unchanged', 'invalid']) }),
  z.object({ status: z.literal('failed'), message: z.string() }),
]);
export type CommitOutcomeDto = z.infer<typeof commitOutcomeSchema>;

// ------------------------------------------------------------------ the page

const providerOptionsSchema = z.object({
  model: z.string(),
  effort: z.string(),
  modelOptions: z.array(z.string()).readonly(),
  effortOptions: z.array(z.string()).readonly(),
});

export const modelRowSchema = z.object({
  fileName: z.string(),
  displayName: z.string(),
  fileSizeGb: z.number(),
  minRamGb: z.number(),
  /** Catalog keys. The page looks the text up in its language when it draws. */
  speedKey: z.string(),
  qualityKey: z.string(),
  useCaseKey: z.string(),
  fit: z.enum(['Recommended', 'MayBeSlow', 'NotRecommended']).nullable(),
  downloaded: z.boolean(),
  active: z.boolean(),
  downloading: z.boolean(),
  percent: z.number().nullable(),
});
export type ModelRowDto = z.infer<typeof modelRowSchema>;

export const settingsPageSchema = z.object({
  settings: appSettingsSchema,
  uiLanguage: uiLanguageTagSchema,
  provider: summaryProviderSchema,
  claude: providerOptionsSchema,
  codex: providerOptionsSchema,
  cliStatus: cliStatusSchema.nullable(),
  transcriptionLanguage: z.string(),
  summaryLanguage: z.string(),
  hardware: z
    .object({
      totalRamGb: z.number(),
      gpuName: z.string().nullable(),
      gpuVramGb: z.number().nullable(),
    })
    .nullable(),
  models: z.object({
    rows: z.array(modelRowSchema).readonly(),
    missingActiveId: z.string().nullable(),
  }),
  /** 'xai-removed' when the saved provider is Xai, which no longer exists (owner decision 2026-11-03). */
  providerNotice: z.literal('xai-removed').nullable(),
  /** Which controls a module behind them has made real. The page offers nothing else. */
  capabilities: z.object({
    localModels: z.boolean(),
  }),
  notices: z
    .array(z.object({ id: z.string(), kind: z.literal('settings-recovered'), keptAs: z.string() }))
    .readonly(),
});
export type SettingsPageDto = z.infer<typeof settingsPageSchema>;

/** Local phase of the page load: settings, hardware, model files, local credential status. */
export const settingsGetPage = defineRequest('settings.getPage', {
  input: empty,
  output: settingsPageSchema,
});

export const settingsSetUiLanguage = defineRequest('settings.setUiLanguage', {
  input: z.object({ tag: z.string().max(40) }),
  output: commitOutcomeSchema,
});

export const settingsSetSummaryProvider = defineRequest('settings.setSummaryProvider', {
  input: z.object({ kind: z.string().max(40) }),
  output: commitOutcomeSchema,
});

export const settingsSetCliOption = defineRequest('settings.setCliOption', {
  input: z.object({
    provider: z.enum(['claude', 'codex']),
    field: z.enum(['model', 'effort']),
    value: z.string().max(300),
  }),
  output: commitOutcomeSchema,
});

export const settingsSetMeetingLanguage = defineRequest('settings.setMeetingLanguage', {
  input: z.object({
    kind: z.enum(['transcription', 'summary']),
    code: z.string().max(40),
  }),
  output: commitOutcomeSchema,
});

/** Looks for the CLI again. Null for providers that are not CLI backed. */
export const settingsDetectCli = defineRequest('settings.detectCli', {
  input: z.object({ kind: summaryProviderSchema }),
  output: z.object({ status: cliStatusSchema.nullable() }),
});

export const settingsDismissNotice = defineRequest('settings.dismissNotice', {
  input: z.object({ id: z.string().max(80) }),
  output: z.object({ dismissed: z.literal(true) }),
});

// -------------------------------------------------------------- local models

const modelFile = z.object({ fileName: z.string().max(200) });

export const settingsModelsDownload = defineRequest('settings.models.download', {
  input: modelFile,
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('done') }),
    z.object({ status: z.literal('failed'), message: z.string() }),
    z.object({ status: z.literal('cancelled') }),
    z.object({
      status: z.literal('ignored'),
      reason: z.enum(['unknown-model', 'already-downloading', 'already-downloaded']),
    }),
  ]),
});

export const settingsModelsCancel = defineRequest('settings.models.cancel', {
  input: modelFile,
  output: z.object({ cancelled: z.literal(true) }),
});

export const settingsModelsSelect = defineRequest('settings.models.select', {
  input: modelFile,
  output: commitOutcomeSchema,
});

export const settingsModelsDelete = defineRequest('settings.models.delete', {
  input: modelFile,
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('deleted'), settings: appSettingsSchema }),
    z.object({ status: z.literal('busy') }),
    z.object({ status: z.literal('failed'), message: z.string() }),
    z.object({ status: z.literal('ignored'), reason: z.literal('unknown-model') }),
  ]),
});

export const modelEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), fileName: z.string(), percent: z.number() }),
  z.object({ type: z.literal('finished'), fileName: z.string() }),
  z.object({ type: z.literal('failed'), fileName: z.string(), message: z.string() }),
  z.object({ type: z.literal('cancelled'), fileName: z.string() }),
  z.object({ type: z.literal('deleted'), fileName: z.string() }),
]);
export type ModelEventDto = z.infer<typeof modelEventSchema>;

export const settingsModelEvent = defineEvent('settings.modelEvent', {
  payload: modelEventSchema,
});

// -------------------------------------------------------- language and restart

/**
 * The language of the screens, for the first paint: the saved choice, else the first OS language
 * we ship, else English. `saved` is false when it came from the OS.
 */
export const i18nGetLocale = defineRequest('i18n.getLocale', {
  input: empty,
  output: z.object({ tag: uiLanguageTagSchema, locale: catalogLocaleSchema, saved: z.boolean() }),
});

/** Pushed after `settings.setUiLanguage` saved, so every window switches together. */
export const i18nLocaleChanged = defineEvent('i18n.localeChanged', {
  payload: z.object({ tag: uiLanguageTagSchema, locale: catalogLocaleSchema }),
});

/** Asks the exit gate, then relaunches. Failure to relaunch comes back as a value. */
export const appRestart = defineRequest('app.restart', {
  input: empty,
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('restarting') }),
    z.object({ status: z.literal('refused') }),
    z.object({ status: z.literal('failed'), message: z.string() }),
  ]),
});
