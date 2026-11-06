import {
  chatChunk,
  chatStateChanged,
  type ChatAttachmentDto,
  type ChatAttachmentListDto,
  type ChatScopeDto,
  type ChatSendOutcomeDto,
  type ChatStateDto,
} from '@vozella/contracts';
import type {
  ChatEngine,
  ChatMessage,
  ChatProviderResolution,
  ChatSendOutcome,
  ChatService,
  LiveContextSnapshot,
  Logger,
  ProviderSource,
  SummaryProviderResolver,
} from '@vozella/core';
import { sendFailedFailure, type TranslateFn } from '@vozella/core';
import type { ChatAttachmentStore } from '@vozella/platform';
import type { Broadcast } from '../summaries/summaries-controller';

/** The slice of the attachment store the controller drives (the store owns the paths). */
export type ChatAttachmentsPort = Pick<
  ChatAttachmentStore,
  'list' | 'add' | 'remove' | 'clear' | 'onChange'
>;

/** The slice of `ChatService` the controller drives. */
export type ChatServicePort = Pick<
  ChatService,
  'send' | 'cancel' | 'newChat' | 'state' | 'onChange' | 'beginScopeRefresh' | 'applyScope'
>;

export interface ChatControllerDeps {
  readonly service: ChatServicePort;
  /** The stored id of the meeting a citation names, or null. Reads the light list only. */
  readonly findMeetingId: (id: string) => Promise<string | null>;
  /** The system clipboard (Electron's `clipboard.writeText` in the app). */
  readonly writeClipboard: (text: string) => Promise<void>;
  /** The system browser (Electron's `shell.openExternal` in the app). */
  readonly openExternal: (url: string) => Promise<void>;
  readonly broadcast: Broadcast;
  readonly logger: Logger;
  /** Maps an unexpected error to a sentence; without it the failure text is generic, never raw. */
  readonly translate?: TranslateFn;
  /**
   * Live scope (T2): the rolling digest and the session context of the take, read when a send
   * starts, next to the renderer's transcript snapshot (B5). Unset sends the transcript alone.
   */
  readonly liveContext?: () => {
    readonly digest: string | null;
    readonly title: string | null;
    readonly notes: string | null;
  };
  /** Files attached to the conversation. Unset: the attach requests answer an empty list. */
  readonly attachments?: ChatAttachmentsPort;
  /** The system file dialog, several files at once. Empty when the user cancels. */
  readonly pickAttachments?: () => Promise<readonly string[]>;
}

/** S2: only http and https leave the app. Anything else, or a string that is not a URL, is refused. */
export function allowedExternalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

const ENGINE_KIND = { 'claude-code': 'ClaudeCode', codex: 'Codex', local: 'Local' } as const;

/**
 * Chat's provider comes from the summaries resolver, so one setting picks the engine for both. A
 * saved prompt's engine asks the resolver for that kind instead, for that send only (Phase 5).
 */
export function chatProviderSource(
  resolver: Pick<SummaryProviderResolver, 'resolveSummaryProvider'>,
): ProviderSource {
  return {
    resolve: async (engine?: ChatEngine): Promise<ChatProviderResolution> => {
      const gate =
        engine === undefined
          ? await resolver.resolveSummaryProvider()
          : await resolver.resolveSummaryProvider({ kind: ENGINE_KIND[engine] });
      if (gate.status === 'ready') return { status: 'ready', provider: gate.provider };
      if (gate.status === 'needs-setup') return { status: 'needs-setup', kind: gate.kind };
      return { status: 'unavailable' };
    },
  };
}

const messageDto = (message: ChatMessage) => ({
  id: message.id,
  role: message.role,
  text: message.text,
  createdAt: message.createdAt.toISOString(),
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What the chat bar asks of the main process. It owns no chat rules: the service does the send,
 * the stream and the cancel. This turns its values into the wire shape and forwards the streamed
 * text as `chat.chunk`. Nothing here throws to the page.
 */
export class ChatController {
  private lastStateKey = '';

  constructor(private readonly deps: ChatControllerDeps) {
    deps.service.onChange(() => {
      this.publishState();
    });
    deps.attachments?.onChange(() => {
      this.publishState();
    });
  }

  async send(input: {
    readonly requestId: string;
    readonly draft: string;
    readonly scope: ChatScopeDto;
    readonly liveTranscript: string | null;
    readonly attachmentIds?: readonly string[];
    /** A saved prompt's engine, for this send only. */
    readonly engine?: ChatEngine;
  }): Promise<ChatSendOutcomeDto> {
    const { service, broadcast } = this.deps;
    let lastText = '';
    // The service reports each coalesced push through onChange; the text so far rides on `pending`.
    const stopListening = service.onChange(() => {
      const text = service.state.pending?.assistantText ?? '';
      if (text === '' || text === lastText) return;
      lastText = text;
      broadcast(chatChunk, { requestId: input.requestId, text });
    });
    try {
      const ids = input.attachmentIds ?? [];
      const live = this.liveSnapshot(input);
      const options = {
        ...(ids.length > 0 ? { attachmentIds: ids } : {}),
        ...(input.engine === undefined ? {} : { engine: input.engine }),
      };
      const outcome =
        Object.keys(options).length === 0
          ? await service.send(input.draft, input.scope, live)
          : await service.send(input.draft, input.scope, live, options);
      return this.toDto(outcome);
    } catch (error) {
      // The service answers values; this guards a bug, not a normal outcome.
      this.deps.logger.error('chat send threw', { error });
      return {
        status: 'failed',
        kind: 'send-failed',
        message: this.deps.translate
          ? sendFailedFailure(error, this.deps.translate).message
          : 'Could not answer.',
        originalDraft: input.draft,
      };
    } finally {
      stopListening();
    }
  }

  /** B5: the digest and session context are read once, here, as the send starts. */
  private liveSnapshot(input: {
    readonly scope: ChatScopeDto;
    readonly liveTranscript: string | null;
  }): string | LiveContextSnapshot | null {
    const read = this.deps.liveContext;
    if (input.scope.kind !== 'Live' || read === undefined) return input.liveTranscript;
    try {
      return { transcript: input.liveTranscript, ...read() };
    } catch (error) {
      this.deps.logger.warn('live chat context unavailable', { error });
      return input.liveTranscript;
    }
  }

  cancel(): boolean {
    const wasSending = this.deps.service.state.isSending;
    this.deps.service.cancel();
    return wasSending;
  }

  /** New chat also drops the attached files. */
  newChat(): boolean {
    const started = this.deps.service.newChat();
    if (started) this.deps.attachments?.clear();
    return started;
  }

  /** Opens the file dialog; the picked paths stay in main. */
  async attachPick(): Promise<ChatAttachmentListDto> {
    let paths: readonly string[] = [];
    try {
      paths = (await this.deps.pickAttachments?.()) ?? [];
    } catch (error) {
      this.deps.logger.warn('chat attach dialog failed', { error });
    }
    return this.attachAdd(paths);
  }

  /** Paths of dropped files, from the preload. The store checks each one before reading it. */
  attachDrop(paths: readonly string[]): Promise<ChatAttachmentListDto> {
    return this.attachAdd(paths);
  }

  attachRemove(id: string): ChatAttachmentListDto {
    this.deps.attachments?.remove(id);
    return { attachments: this.attachmentDtos(), notice: null };
  }

  attachList(): ChatAttachmentListDto {
    return { attachments: this.attachmentDtos(), notice: null };
  }

  private async attachAdd(paths: readonly string[]): Promise<ChatAttachmentListDto> {
    const store = this.deps.attachments;
    if (store === undefined || paths.length === 0) return this.attachList();
    try {
      const { notice } = await store.add(paths);
      return { attachments: this.attachmentDtos(), notice };
    } catch (error) {
      this.deps.logger.error('chat attach failed', { error });
      return this.attachList();
    }
  }

  private attachmentDtos(): ChatAttachmentDto[] {
    return (this.deps.attachments?.list() ?? []).map((a) => ({ ...a }));
  }

  state(): ChatStateDto {
    return this.stateDto();
  }

  setScope(scope: ChatScopeDto): ChatStateDto {
    const token = this.deps.service.beginScopeRefresh();
    this.deps.service.applyScope(token, scope);
    return this.stateDto();
  }

  async meetingExists(id: string): Promise<{ exists: boolean; meetingId: string | null }> {
    try {
      const found = await this.deps.findMeetingId(id);
      return { exists: found !== null, meetingId: found };
    } catch (error) {
      this.deps.logger.warn('chat meeting lookup failed', { error });
      return { exists: false, meetingId: null };
    }
  }

  async copyText(text: string) {
    try {
      await this.deps.writeClipboard(text);
      return { status: 'written' as const };
    } catch (error) {
      return { status: 'failed' as const, detail: messageOf(error) };
    }
  }

  async openExternal(raw: string) {
    const url = allowedExternalUrl(raw);
    if (url === null) {
      this.deps.logger.warn('chat refused an external link', { scheme: raw.slice(0, 12) });
      return { status: 'rejected' as const };
    }
    try {
      await this.deps.openExternal(url);
      return { status: 'opened' as const };
    } catch (error) {
      return { status: 'failed' as const, detail: messageOf(error) };
    }
  }

  private toDto(outcome: ChatSendOutcome): ChatSendOutcomeDto {
    switch (outcome.status) {
      case 'ignored':
        return { status: 'empty' };
      case 'sent':
        return {
          status: 'answered',
          user: messageDto(outcome.user),
          assistant: messageDto(outcome.assistant),
          notice: outcome.notice,
        };
      case 'cancelled':
        return { status: 'cancelled', originalDraft: outcome.originalDraft };
      case 'setup-required':
        return {
          status: 'setup-required',
          kind: outcome.kind,
          originalDraft: outcome.originalDraft,
        };
      case 'failed':
        return {
          status: 'failed',
          kind: outcome.failure.kind,
          message: outcome.failure.message,
          originalDraft: outcome.originalDraft,
        };
    }
  }

  private stateDto(): ChatStateDto {
    const { state } = this.deps.service;
    return {
      messages: state.messages.map(messageDto),
      isSending: state.isSending,
      showScopeMismatch: state.showScopeMismatch,
      hasMessages: state.hasMessages,
      canStartNewChat: state.canStartNewChat,
      attachments: this.attachmentDtos(),
    };
  }

  /** Streamed text does not change the state shape, so only a real change goes out. */
  private publishState(): void {
    const state = this.stateDto();
    const key = JSON.stringify([
      state.messages.map((m) => m.id),
      state.isSending,
      state.showScopeMismatch,
      state.hasMessages,
      state.canStartNewChat,
      state.attachments,
    ]);
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    this.deps.broadcast(chatStateChanged, { state });
  }
}
