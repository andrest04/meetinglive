import { z } from 'zod';
import { defineEvent, defineRequest } from './channel';
import { summarySetupKindSchema } from './summaries';

/**
 * Chat channels (module: chat). One in-memory conversation lives in the main process. Every
 * answer is a value: a missing model, a failed provider or a stopped answer come back as a
 * `status`, never as a thrown error.
 */

const empty = z.object({}).strict();
const requestId = z.string().min(1).max(100);

export const chatScopeKindSchema = z.enum(['AllMeetings', 'Folder', 'Meeting', 'Live']);

/** The scope the renderer resolved from the workspace state (spec 3.2). */
export const chatScopeSchema = z.object({
  isVisible: z.boolean(),
  kind: chatScopeKindSchema,
  folderId: z.string().max(200).nullable(),
  meetingId: z.string().max(200).nullable(),
});
export type ChatScopeDto = z.infer<typeof chatScopeSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  /** ISO 8601. */
  createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

export const chatAttachmentKindSchema = z.enum(['pdf', 'docx', 'pptx', 'text', 'image']);

/**
 * A file attached to the conversation, as a chip. The path stays in the main process: the page
 * only ever holds this opaque id.
 */
export const chatAttachmentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(400),
  kind: chatAttachmentKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  /** Pages of a PDF or slides of a presentation, once read; null otherwise. */
  pages: z.number().int().nonnegative().nullable(),
  /** `reading` while the text is extracted; `error` files are never sent. */
  status: z.enum(['reading', 'ready', 'error']),
  /** Why the file failed, or a note on a ready one, in the language of the app. */
  message: z.string().nullable(),
  /** Only the first 200,000 characters were read. */
  truncated: z.boolean(),
});
export type ChatAttachmentDto = z.infer<typeof chatAttachmentSchema>;

/** At most this many files per conversation, and per send. */
export const CHAT_ATTACHMENT_MAX = 10;

export const chatAttachmentListSchema = z.object({
  attachments: z.array(chatAttachmentSchema).max(CHAT_ATTACHMENT_MAX),
  /** A sentence about files that were not added (over the limit), or null. */
  notice: z.string().nullable(),
});
export type ChatAttachmentListDto = z.infer<typeof chatAttachmentListSchema>;

export const chatFailureKindSchema = z.enum([
  'setup-cancelled',
  'empty-answer',
  'send-failed',
  'provider-removed',
]);

export const chatSendOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('answered'),
    user: chatMessageSchema,
    assistant: chatMessageSchema,
    /** A line to show with the answer (images the local engine left out), or null. */
    notice: z.string().nullable().default(null),
  }),
  /** No engine is ready: the page runs the provider gate and sends again with the same draft. */
  z.object({
    status: z.literal('setup-required'),
    kind: summarySetupKindSchema,
    originalDraft: z.string(),
  }),
  z.object({
    status: z.literal('failed'),
    kind: chatFailureKindSchema,
    /** The sentence, already in the language of the app. */
    message: z.string(),
    originalDraft: z.string(),
  }),
  /** The user stopped the answer. Silent. */
  z.object({ status: z.literal('cancelled'), originalDraft: z.string() }),
  /** Nothing was sent: blank draft, chat hidden, or an answer already running. */
  z.object({ status: z.literal('empty') }),
]);
export type ChatSendOutcomeDto = z.infer<typeof chatSendOutcomeSchema>;

export const chatStateSchema = z.object({
  messages: z.array(chatMessageSchema).readonly(),
  isSending: z.boolean(),
  showScopeMismatch: z.boolean(),
  hasMessages: z.boolean(),
  canStartNewChat: z.boolean(),
  /** The files attached to this conversation, in the order they were added. */
  attachments: z.array(chatAttachmentSchema).max(CHAT_ATTACHMENT_MAX).default([]),
});
export type ChatStateDto = z.infer<typeof chatStateSchema>;

/** Engines a saved prompt can name (Phase 5). */
export const chatEngineSchema = z.enum(['claude-code', 'codex', 'local']);
export type ChatEngineDto = z.infer<typeof chatEngineSchema>;

export const chatSend = defineRequest('chat.send', {
  input: z.object({
    requestId,
    draft: z.string().max(100_000),
    scope: chatScopeSchema,
    /** The live transcript as the renderer's workspace state held it when the user pressed send. */
    liveTranscript: z.string().max(2_000_000).nullable(),
    /** Ids from `chat.attach.*`. Unknown or failed ids are skipped by main. */
    attachmentIds: z.array(z.string().min(1).max(100)).max(CHAT_ATTACHMENT_MAX).default([]),
    /** A saved prompt's engine, for this send only. Unset uses the engine from Settings. */
    engine: chatEngineSchema.optional(),
  }),
  output: chatSendOutcomeSchema,
});

// Saved prompts (Phase 5). The same limits as core's `user-prompts.ts`.
export const CHAT_PROMPT_NAME_MAX = 60;
export const CHAT_PROMPT_TEXT_MAX = 4_000;
export const CHAT_PROMPT_LIMIT = 100;

/** What the create and edit dialog sends. Text is trimmed before the limits apply. */
export const chatPromptDraftSchema = z.object({
  name: z.string().trim().min(1).max(CHAT_PROMPT_NAME_MAX),
  prompt: z.string().trim().min(1).max(CHAT_PROMPT_TEXT_MAX),
  availability: z.enum(['single', 'multiple']),
  /** Null: the engine chosen in Settings. */
  engine: chatEngineSchema.nullable(),
});
export type ChatPromptDraftDto = z.infer<typeof chatPromptDraftSchema>;

export const chatPromptSchema = chatPromptDraftSchema.extend({ id: z.string().min(1).max(100) });
export type ChatPromptDto = z.infer<typeof chatPromptSchema>;

const promptList = z.array(chatPromptSchema).max(CHAT_PROMPT_LIMIT);

const promptSaveOutcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), prompt: chatPromptSchema }),
  /** Already 100 saved prompts. */
  z.object({ status: z.literal('limit') }),
  /** The prompt was deleted meanwhile. */
  z.object({ status: z.literal('not-found') }),
  z.object({ status: z.literal('failed') }),
]);
export type ChatPromptSaveOutcomeDto = z.infer<typeof promptSaveOutcome>;

/** The saved prompts, in saved order. */
export const chatPromptsList = defineRequest('chat.prompts.list', {
  input: empty,
  output: z.object({ prompts: promptList }),
});

export const chatPromptsCreate = defineRequest('chat.prompts.create', {
  input: z.object({ draft: chatPromptDraftSchema }),
  output: promptSaveOutcome,
});

export const chatPromptsUpdate = defineRequest('chat.prompts.update', {
  input: z.object({ id: z.string().min(1).max(100), draft: chatPromptDraftSchema }),
  output: promptSaveOutcome,
});

export const chatPromptsDelete = defineRequest('chat.prompts.delete', {
  input: z.object({ id: z.string().min(1).max(100) }),
  output: z.object({ status: z.enum(['deleted', 'not-found', 'failed']) }),
});

/** Opens the save dialog and writes `.vozella-prompts.json` (`{ version: 1, prompts }`). */
export const chatPromptsExport = defineRequest('chat.prompts.export', {
  input: empty,
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('exported'), count: z.number().int().nonnegative() }),
    z.object({ status: z.literal('cancelled') }),
    z.object({ status: z.literal('failed') }),
  ]),
});
export type ChatPromptsExportOutcomeDto = z.infer<typeof chatPromptsExport.output>;

/** Opens the file dialog, checks the file and adds its prompts; taken names get "(2)". */
export const chatPromptsImport = defineRequest('chat.prompts.import', {
  input: empty,
  output: z.discriminatedUnion('status', [
    z.object({
      status: z.literal('imported'),
      added: z.number().int().nonnegative(),
      renamed: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
    z.object({ status: z.literal('cancelled') }),
    /** Not a prompts file, or one entry breaks the rules: nothing was added. */
    z.object({ status: z.literal('invalid') }),
    z.object({ status: z.literal('failed') }),
  ]),
});
export type ChatPromptsImportOutcomeDto = z.infer<typeof chatPromptsImport.output>;

/** Any change to the saved prompts, from any window. */
export const chatPromptsChanged = defineEvent('chat.promptsChanged', {
  payload: z.object({ prompts: promptList }),
});

/** Opens the file dialog (several files). Main remembers the paths; the answer is the chip list. */
export const chatAttachPick = defineRequest('chat.attach.pick', {
  input: empty,
  output: chatAttachmentListSchema,
});

/**
 * Files dropped on the panel. The preload turns the dropped `File`s into paths
 * (`webUtils.getPathForFile`); main checks each one (a local regular file, an allowed type, at most
 * 20 MB) before reading it.
 */
export const chatAttachDrop = defineRequest('chat.attach.drop', {
  input: z.object({
    paths: z.array(z.string().min(1).max(4_096)).min(1).max(CHAT_ATTACHMENT_MAX),
  }),
  output: chatAttachmentListSchema,
});

export const chatAttachRemove = defineRequest('chat.attach.remove', {
  input: z.object({ id: z.string().min(1).max(100) }),
  output: chatAttachmentListSchema,
});

export const chatAttachList = defineRequest('chat.attach.list', {
  input: empty,
  output: chatAttachmentListSchema,
});

/** The answer so far for the running send, about every 80 ms. */
export const chatChunk = defineEvent('chat.chunk', {
  payload: z.object({ requestId, text: z.string() }),
});

export const chatCancel = defineRequest('chat.cancel', {
  input: empty,
  /** False when nothing was running. */
  output: z.object({ cancelled: z.boolean() }),
});

/** New chat. Refused (false) while an answer is running (B1). */
export const chatNewChat = defineRequest('chat.newChat', {
  input: empty,
  output: z.object({ started: z.boolean() }),
});

export const chatState = defineRequest('chat.state', {
  input: empty,
  output: chatStateSchema,
});

/** Tells main the current scope so the mismatch notice follows it. */
export const chatSetScope = defineRequest('chat.setScope', {
  input: z.object({ scope: chatScopeSchema }),
  output: chatStateSchema,
});

export const chatStateChanged = defineEvent('chat.stateChanged', {
  payload: z.object({ state: chatStateSchema }),
});

/** Does the meeting named by a citation link exist (B21)? The id may be hex without hyphens. */
export const chatMeetingExists = defineRequest('chat.meetingExists', {
  input: z.object({ meetingId: z.string().min(1).max(200) }),
  output: z.object({ exists: z.boolean(), meetingId: z.string().nullable() }),
});

export const chatCopyText = defineRequest('chat.copyText', {
  input: z.object({ text: z.string().min(1).max(1_000_000) }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('written') }),
    z.object({ status: z.literal('failed'), detail: z.string() }),
  ]),
});

/** Opens an http or https link in the system browser. Any other scheme is refused (S2). */
export const chatOpenExternal = defineRequest('chat.openExternal', {
  input: z.object({ url: z.string().min(1).max(4_096) }),
  output: z.discriminatedUnion('status', [
    z.object({ status: z.literal('opened') }),
    z.object({ status: z.literal('rejected') }),
    z.object({ status: z.literal('failed'), detail: z.string() }),
  ]),
});
