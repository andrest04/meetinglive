import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';
import { appSettingsSchema } from './library';
import { modelRowSchema } from './settings';

/**
 * Summary channels (module: summaries). Every answer is a value: a failed run, a busy meeting,
 * a missing model or CLI come back as a `status`, never as a thrown error.
 */

const empty = z.object({}).strict();
const meetingId = z.string().min(1).max(200);

export const summaryCliKindSchema = z.enum(['ClaudeCode', 'Codex']);
export type SummaryCliKindDto = z.infer<typeof summaryCliKindSchema>;
export const summarySetupKindSchema = z.enum(['Local', 'ClaudeCode', 'Codex']);

const actionItemSchema = z.object({ text: z.string(), isDone: z.boolean() });

const templateOptionSchema = z.object({
  id: z.string(),
  labelKey: z.string().nullable(),
  name: z.string().nullable(),
});

const tabFlagsSchema = z.object({
  hasSummary: z.boolean(),
  canGenerate: z.boolean(),
  canRegenerate: z.boolean(),
  showEnhancedChrome: z.boolean(),
  showNoteTemplate: z.boolean(),
  showSummaryActionBar: z.boolean(),
  showDraftActions: z.boolean(),
  isEmpty: z.boolean(),
  canExecuteGenerate: z.boolean(),
  canExecuteRegenerate: z.boolean(),
});

export const summaryTabStateSchema = z.object({
  meetingId: z.string().nullable(),
  hasMeeting: z.boolean(),
  title: z.string(),
  notes: z.string(),
  summary: z.string(),
  actionItems: z.array(actionItemSchema).readonly(),
  noteTemplateId: z.string(),
  templates: z.array(templateOptionSchema).readonly(),
  related: z
    .array(z.object({ id: z.string(), title: z.string(), recordedAt: z.string() }))
    .readonly(),
  flags: tabFlagsSchema,
  hasTranscript: z.boolean(),
});
export type SummaryTabStateDto = z.infer<typeof summaryTabStateSchema>;

// ---------------------------------------------------------------- the tab

export const summariesLoadTab = defineRequest('summaries.loadTab', {
  input: z.object({ meetingId: meetingId.nullable() }),
  output: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('loaded'),
      state: summaryTabStateSchema,
      /** A run is going for this meeting now, so a page opened late shows it. */
      generating: z.boolean(),
    }),
    z.object({ status: z.literal('failed'), detail: z.string() }),
  ]),
});

export const generateOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('generated'),
    title: z.string(),
    titleChanged: z.boolean(),
    summary: z.string(),
    actionItems: z.array(actionItemSchema).readonly(),
    providerId: z.enum(['local', 'claude-code', 'codex']),
  }),
  z.object({ status: z.literal('no-transcript') }),
  z.object({ status: z.literal('not-found') }),
  z.object({ status: z.literal('busy') }),
  z.object({
    status: z.literal('needs-setup'),
    kind: summarySetupKindSchema,
    reason: z.enum(['model-missing', 'cli-missing']),
  }),
  z.object({ status: z.literal('unavailable'), reason: z.literal('xai-removed') }),
  z.object({ status: z.literal('cancelled') }),
  z.object({
    status: z.literal('failed'),
    code: z.string(),
    args: z.array(z.union([z.string(), z.number()])).readonly(),
    detail: z.string().nullable(),
    /** The sentence, already in the language of the app. */
    message: z.string(),
  }),
]);
export type GenerateOutcomeDto = z.infer<typeof generateOutcomeSchema>;

export const summariesGenerate = defineRequest('summaries.generate', {
  input: z.object({
    meetingId,
    regenerate: z.boolean(),
    /** The picker's choice. Omitted means the template stored on the meeting. */
    templateId: z.string().max(80).nullable().optional(),
  }),
  output: generateOutcomeSchema,
});

export const summariesCancel = defineRequest('summaries.cancel', {
  input: z.object({ meetingId }),
  /** False when nothing was running for that meeting. */
  output: z.object({ cancelled: z.boolean() }),
});

export const summariesSaveNotes = defineRequest('summaries.saveNotes', {
  input: z.object({ meetingId, text: z.string().max(2_000_000) }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.enum(['saved', 'unchanged', 'not-found']) }),
    z.object({ status: z.literal('failed'), detail: z.string() }),
  ]),
});

export const summariesToggleAction = defineRequest('summaries.toggleAction', {
  input: z.object({ meetingId, index: z.number().int().min(0), done: z.boolean() }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), actionItems: z.array(actionItemSchema).readonly() }),
    z.object({ status: z.enum(['not-found', 'out-of-range']) }),
    z.object({ status: z.literal('failed'), message: z.string(), detail: z.string() }),
  ]),
});

export const summariesCopyActions = defineRequest('summaries.copyActions', {
  input: z.object({ meetingId }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('empty'), message: z.string() }),
    z.object({ status: z.literal('copied'), text: z.string() }),
    z.object({ status: z.literal('not-found') }),
  ]),
});

/** The session-level Copy command: the notes or the summary, null when that text is blank (item 104). */
export const summariesCopyText = defineRequest('summaries.copyText', {
  input: z.object({ meetingId, mode: z.enum(['notes', 'summary']) }),
  output: z.object({ text: z.string().nullable() }),
});

/**
 * Puts text on the system clipboard from the main process. The renderer's own clipboard API is
 * denied by the window's permission handler, so every copy goes through here.
 */
export const summariesWriteClipboard = defineRequest('summaries.writeClipboard', {
  input: z.object({ text: z.string().max(1_000_000) }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('written') }),
    z.object({ status: z.literal('failed'), detail: z.string() }),
  ]),
});

export const summariesSetTemplate = defineRequest('summaries.setTemplate', {
  input: z.object({ meetingId, templateId: z.string().max(80).nullable() }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.enum(['saved', 'unchanged', 'not-found']) }),
    z.object({ status: z.literal('failed'), detail: z.string() }),
  ]),
});

/** A run started or ended, for every window. */
export const summariesProgress = defineEvent('summaries.progress', {
  payload: z.object({ meetingId, running: z.boolean() }),
});

// ------------------------------------------------------------- setup flow

/** What the generation gate says about the selected engine, as a value. */
export const summariesProviderStatus = defineRequest('summaries.providerStatus', {
  input: empty,
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('ready'), kind: summarySetupKindSchema }),
    z.object({
      status: z.literal('needs-setup'),
      kind: summarySetupKindSchema,
      reason: z.enum(['model-missing', 'cli-missing']),
    }),
    z.object({ status: z.literal('unavailable'), reason: z.literal('xai-removed') }),
  ]),
});

/** The wizard's model step: every catalog row with its fit and the one to pre-select. */
export const summariesHardware = defineRequest('summaries.hardware', {
  input: empty,
  output: z.object({
    hardware: z
      .object({
        totalRamGb: z.number(),
        gpuName: z.string().nullable(),
        gpuVramGb: z.number().nullable(),
      })
      .nullable(),
    rows: z.array(modelRowSchema).readonly(),
    /** First downloaded, else first Recommended, else first. */
    defaultFileName: z.string().nullable(),
  }),
});

export const summariesCheckCli = defineRequest('summaries.checkCli', {
  input: z.object({ kind: summaryCliKindSchema }),
  output: z.object({
    found: z.boolean(),
    executable: z.enum(['claude', 'codex']),
    /** Catalog key of the install hint. */
    hintKey: z.enum(['Cli_ClaudeHint', 'Cli_CodexHint']),
  }),
});

/**
 * Downloads the model if it is not on disk, then saves the model and the Local provider in one
 * write. Progress arrives as `settings.modelEvent`.
 */
export const summariesChooseLocalModel = defineRequest('summaries.chooseLocalModel', {
  input: z.object({ fileName: z.string().min(1).max(200) }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), settings: appSettingsSchema }),
    z.object({ status: z.literal('failed'), message: z.string() }),
    z.object({ status: z.literal('cancelled') }),
    z.object({ status: z.literal('ignored'), reason: z.literal('unknown-model') }),
  ]),
});

export const summariesCancelLocalModel = defineRequest('summaries.cancelLocalModel', {
  input: z.object({ fileName: z.string().min(1).max(200) }),
  output: z.object({ cancelled: z.literal(true) }),
});

/** Saves the CLI as the provider when its executable is on PATH. */
export const summariesChooseCli = defineRequest('summaries.chooseCli', {
  input: z.object({ kind: summaryCliKindSchema }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('saved'), settings: appSettingsSchema }),
    z.object({
      status: z.literal('not-found'),
      executable: z.enum(['claude', 'codex']),
      hintKey: z.enum(['Cli_ClaudeHint', 'Cli_CodexHint']),
    }),
    z.object({ status: z.literal('failed'), message: z.string() }),
  ]),
});
