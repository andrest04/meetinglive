import {
  chatChunk,
  chatStateChanged,
  type ChatScopeDto,
  type ChatSendOutcomeDto,
  type ChatStateDto,
} from '@vozella/contracts';
import type {
  ChatMessage,
  ChatProviderResolution,
  ChatSendOutcome,
  ChatService,
  Logger,
  ProviderSource,
  SummaryProviderResolver,
} from '@vozella/core';
import type { Broadcast } from '../summaries/summaries-controller';

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

/** Chat's provider comes from the summaries resolver, so one setting picks the engine for both. */
export function chatProviderSource(
  resolver: Pick<SummaryProviderResolver, 'resolveSummaryProvider'>,
): ProviderSource {
  return {
    resolve: async (): Promise<ChatProviderResolution> => {
      const gate = await resolver.resolveSummaryProvider();
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
  }

  async send(input: {
    readonly requestId: string;
    readonly draft: string;
    readonly scope: ChatScopeDto;
    readonly liveTranscript: string | null;
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
      const outcome = await service.send(input.draft, input.scope, input.liveTranscript);
      return this.toDto(outcome);
    } catch (error) {
      // The service answers values; this guards a bug, not a normal outcome.
      this.deps.logger.error('chat send threw', { error });
      return {
        status: 'failed',
        kind: 'send-failed',
        message: messageOf(error),
        originalDraft: input.draft,
      };
    } finally {
      stopListening();
    }
  }

  cancel(): boolean {
    const wasSending = this.deps.service.state.isSending;
    this.deps.service.cancel();
    return wasSending;
  }

  newChat(): boolean {
    return this.deps.service.newChat();
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
    ]);
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    this.deps.broadcast(chatStateChanged, { state });
  }
}
