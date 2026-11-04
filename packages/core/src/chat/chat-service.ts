import type { CancelSignal } from '../cancel';
import { CancelSource } from '../cancel';
import type { Clock } from '../clock';
import type { TranslateFn } from '../i18n/translator';
import type { PromptCallOptions } from '../summaries/provider';
import type { SetupKind } from '../summaries/provider-resolver';
import {
  emptyAnswerFailure,
  isCancellation,
  providerRemovedFailure,
  sendFailedFailure,
  setupCancelledFailure,
  type ChatFailure,
} from './chat-errors';
import { packContext, type ContextFolder, type ContextMeeting } from './context-packer';
import { buildPrompt } from './prompt-builder';
import { matchesOpenThread, type ChatScopeDecision } from './scope-resolver';
import { StreamCoalescer } from './stream-coalescer';

/**
 * Core ports for chat. Each query is scoped by id or folder (B17), so a send never loads every
 * meeting just to answer about one.
 */
export interface ChatMeetingReader {
  meetingById(id: string): Promise<ContextMeeting | null>;
  meetingsInFolder(folderId: string): Promise<readonly ContextMeeting[]>;
  /** Every meeting, in any order: the packer sorts and caps. */
  listRecent(): Promise<readonly ContextMeeting[]>;
  listFolders(): Promise<readonly ContextFolder[]>;
}

/** The slice of `SummaryProvider` chat uses. */
export interface ChatStreamProvider {
  streamPrompt(
    prompt: string,
    cancel: CancelSignal,
    options?: PromptCallOptions,
  ): AsyncIterable<string>;
}

/** Mirrors `ProviderResolution`: ready, needs a gate, or removed. */
export type ChatProviderResolution =
  | { readonly status: 'ready'; readonly provider: ChatStreamProvider }
  | { readonly status: 'needs-setup'; readonly kind: SetupKind }
  | { readonly status: 'unavailable' };

export interface ProviderSource {
  resolve(): Promise<ChatProviderResolution>;
}

/**
 * Runs the existing setup gate (model download, CLI check). Returns the ready provider, or null
 * when the user cancelled it.
 */
export type SetupGate = (kind: SetupKind) => Promise<ChatStreamProvider | null>;

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly createdAt: Date;
}

interface Conversation {
  readonly scope: ChatScopeDecision;
  readonly messages: readonly ChatMessage[];
}

/** The turn being answered: the user row and the pending assistant row (spec 2.4 step 3). */
export interface PendingTurn {
  readonly userText: string;
  readonly assistantText: string;
}

export interface ChatState {
  readonly messages: readonly ChatMessage[];
  readonly isSending: boolean;
  readonly pending: PendingTurn | null;
  /** Recomputed from the current scope, also while sending (B24). */
  readonly showScopeMismatch: boolean;
  readonly hasMessages: boolean;
  /** New chat is off while sending (B1). */
  readonly canStartNewChat: boolean;
}

export type ChatSendOutcome =
  | { readonly status: 'ignored' }
  | { readonly status: 'sent'; readonly user: ChatMessage; readonly assistant: ChatMessage }
  /** The user stopped the answer. Silent: no message, nothing kept. */
  | { readonly status: 'cancelled'; readonly originalDraft: string }
  /** No gate was given: the caller runs it and sends again. */
  | {
      readonly status: 'setup-required';
      readonly kind: SetupKind;
      readonly originalDraft: string;
    }
  | { readonly status: 'failed'; readonly failure: ChatFailure; readonly originalDraft: string };

export interface ChatServiceDeps {
  readonly meetings: ChatMeetingReader;
  readonly providers: ProviderSource;
  readonly clock: Clock;
  readonly translate: TranslateFn;
  readonly newId: () => string;
}

export interface SendOptions {
  readonly setupGate?: SetupGate;
}

/** Hands out a number per refresh so an older, slower refresh cannot overwrite a newer one. */
export class ScopeRefreshGuard {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }
}

const threadScope = (scope: ChatScopeDecision) => ({
  scopeKind: scope.kind,
  folderId: scope.folderId,
  meetingId: scope.meetingId,
});

/**
 * One in-memory conversation for the app session (thread history is dropped). The scope it
 * started under decides whether a later send continues it or starts a fresh one.
 */
export class ChatService {
  private conversation: Conversation | null = null;
  private decision: ChatScopeDecision = {
    isVisible: true,
    kind: 'AllMeetings',
    folderId: null,
    meetingId: null,
  };
  private sending = false;
  private pending: PendingTurn | null = null;
  private cancelSource: CancelSource | null = null;
  private readonly refreshGuard = new ScopeRefreshGuard();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: ChatServiceDeps) {}

  get state(): ChatState {
    const messages = this.conversation?.messages ?? [];
    return {
      messages,
      isSending: this.sending,
      pending: this.pending,
      showScopeMismatch:
        this.conversation !== null &&
        this.decision.isVisible &&
        !matchesOpenThread(threadScope(this.conversation.scope), this.decision),
      hasMessages: messages.length > 0 || this.pending !== null,
      canStartNewChat: !this.sending,
    };
  }

  get scope(): ChatScopeDecision {
    return this.decision;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts a scope refresh. Pass the token to `applyScope` with the result. */
  beginScopeRefresh(): number {
    return this.refreshGuard.begin();
  }

  /** Applies a refresh result unless a newer refresh began. Returns whether it was applied. */
  applyScope(token: number, decision: ChatScopeDecision): boolean {
    if (!this.refreshGuard.isCurrent(token)) return false;
    this.decision = decision;
    this.notify();
    return true;
  }

  /** Clears the conversation. Refused while sending (B1). */
  newChat(): boolean {
    if (this.sending) return false;
    this.conversation = null;
    this.notify();
    return true;
  }

  /** The stop button (B19). Does nothing when no send is running. */
  cancel(): void {
    this.cancelSource?.cancel();
  }

  async send(
    draft: string,
    decision: ChatScopeDecision,
    liveTranscriptSnapshot: string | null,
    options: SendOptions = {},
  ): Promise<ChatSendOutcome> {
    const userText = draft.trim();
    if (this.sending || !decision.isVisible || userText === '') return { status: 'ignored' };

    // B5: the scope and the live transcript are fixed here, not read again later.
    const scope = { ...decision };
    const t = this.deps.translate;
    const userCreatedAt = this.deps.clock.now();
    const cancelSource = new CancelSource();
    this.cancelSource = cancelSource;
    this.sending = true;
    this.pending = { userText, assistantText: '' };
    this.notify();

    const wasStopped = (): boolean => cancelSource.cancelled;
    const cancelled = (): ChatSendOutcome => ({ status: 'cancelled', originalDraft: draft });
    const fail = (failure: ChatFailure): ChatSendOutcome => ({
      status: 'failed',
      failure,
      originalDraft: draft,
    });

    try {
      const prior =
        this.conversation !== null && matchesOpenThread(threadScope(this.conversation.scope), scope)
          ? this.conversation.messages
          : [];

      const context = await this.pack(scope, liveTranscriptSnapshot);
      if (wasStopped()) return cancelled();
      const prompt = buildPrompt(
        scope.kind,
        context,
        prior.map((m) => ({ role: m.role, text: m.text })),
        userText,
      );

      const resolution = await this.deps.providers.resolve();
      let provider: ChatStreamProvider;
      if (resolution.status === 'unavailable') return fail(providerRemovedFailure(t));
      if (resolution.status === 'needs-setup') {
        if (options.setupGate === undefined) {
          return { status: 'setup-required', kind: resolution.kind, originalDraft: draft };
        }
        const gated = await options.setupGate(resolution.kind);
        if (gated === null) return fail(setupCancelledFailure(t));
        provider = gated;
      } else {
        provider = resolution.provider;
      }
      if (wasStopped()) return cancelled();

      const answer = await this.stream(provider, prompt, cancelSource);
      // B20: a stopped answer is dropped, even when the provider returned text before it noticed.
      if (wasStopped()) return cancelled();

      const text = answer.trim();
      if (text === '') return fail(emptyAnswerFailure(t));

      // B7: the two messages get their own timestamps.
      const user: ChatMessage = {
        id: this.deps.newId(),
        role: 'user',
        text: userText,
        createdAt: userCreatedAt,
      };
      const assistant: ChatMessage = {
        id: this.deps.newId(),
        role: 'assistant',
        text,
        createdAt: this.deps.clock.now(),
      };
      this.conversation = { scope, messages: [...prior, user, assistant] };
      return { status: 'sent', user, assistant };
    } catch (error) {
      if (wasStopped() || isCancellation(error)) return cancelled();
      return fail(sendFailedFailure(error, t));
    } finally {
      this.sending = false;
      this.pending = null;
      this.cancelSource = null;
      this.notify();
    }
  }

  private async pack(scope: ChatScopeDecision, live: string | null): Promise<string> {
    const reader = this.deps.meetings;
    let meetings: readonly ContextMeeting[] = [];
    if (scope.kind === 'Meeting' && scope.meetingId !== null) {
      const found = await reader.meetingById(scope.meetingId);
      meetings = found === null ? [] : [found];
    } else if (scope.kind === 'Folder' && scope.folderId !== null) {
      meetings = await reader.meetingsInFolder(scope.folderId);
    } else if (scope.kind === 'AllMeetings') {
      meetings = await reader.listRecent();
    }
    const folders =
      scope.kind === 'Folder' || scope.kind === 'AllMeetings' ? await reader.listFolders() : [];
    return packContext(
      scope.kind,
      scope.folderId,
      scope.meetingId,
      live,
      meetings,
      folders,
      this.deps.translate,
    );
  }

  private async stream(
    provider: ChatStreamProvider,
    prompt: string,
    cancelSource: CancelSource,
  ): Promise<string> {
    const coalescer = new StreamCoalescer(this.deps.clock, (text) => {
      if (cancelSource.cancelled || this.pending === null) return;
      this.pending = { userText: this.pending.userText, assistantText: text };
      this.notify();
    });
    for await (const chunk of provider.streamPrompt(prompt, cancelSource.signal)) {
      if (cancelSource.cancelled) break;
      coalescer.append(chunk);
    }
    if (!cancelSource.cancelled) coalescer.flush();
    return coalescer.text;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
