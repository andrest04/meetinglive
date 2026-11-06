import type { CancelSignal } from '../cancel';
import { CancelSource } from '../cancel';
import type { Clock } from '../clock';
import type { TranslateFn } from '../i18n/translator';
import type { Logger } from '../logging';
import type { CliPromptOptions } from '../summaries/cli-provider';
import type { ProviderId } from '../summaries/provider';
import type { SetupKind } from '../summaries/provider-resolver';
import {
  attachmentBudgetFor,
  isCliEngine,
  packAttachments,
  type ChatAttachmentSource,
  type ResolvedAttachments,
  type StagedImages,
} from './attachments';
import {
  emptyAnswerFailure,
  isCancellation,
  providerRemovedFailure,
  sendFailedFailure,
  setupCancelledFailure,
  type ChatFailure,
} from './chat-errors';
import {
  contextBudgetFor,
  packContext,
  type ContextBudget,
  type ContextFolder,
  type ContextMeeting,
  type LiveContextSnapshot,
} from './context-packer';
import { answerLanguageName, buildPrompt, priorTurnLimitsFor } from './prompt-builder';
import { matchesOpenThread, type ChatScopeDecision } from './scope-resolver';
import { StreamCoalescer } from './stream-coalescer';
import type { ChatEngine } from './user-prompts';

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

/** What chat passes with a prompt: the shared options plus the images of the send. */
export type ChatPromptOptions = CliPromptOptions;

/** The slice of `SummaryProvider` chat uses. */
export interface ChatStreamProvider {
  /** Sizes the packed context (T2). Unset is treated as the local engine, the smallest budget. */
  readonly id?: ProviderId;
  /** Engines that cannot take images ignore `options.images`; chat only sends them to CLIs. */
  streamPrompt(
    prompt: string,
    cancel: CancelSignal,
    options?: ChatPromptOptions,
  ): AsyncIterable<string>;
}

/** Mirrors `ProviderResolution`: ready, needs a gate, or removed. */
export type ChatProviderResolution =
  | { readonly status: 'ready'; readonly provider: ChatStreamProvider }
  | { readonly status: 'needs-setup'; readonly kind: SetupKind }
  | { readonly status: 'unavailable' };

export interface ProviderSource {
  /** `engine` is a saved prompt's engine for this send only; unset uses the one from Settings. */
  resolve(engine?: ChatEngine): Promise<ChatProviderResolution>;
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
  | {
      readonly status: 'sent';
      readonly user: ChatMessage;
      readonly assistant: ChatMessage;
      /** A line to show next to the answer (images the local engine left out), or null. */
      readonly notice: string | null;
    }
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
  /** Optional: gets one timing line per answer (time to first chunk, total). */
  readonly logger?: Logger;
  /** UI language tag (`es`, `en-US`), read on every send: the fallback answer language (T2). */
  readonly uiLanguage?: () => string;
  /** Files attached to the conversation. Unset: sends never carry files. */
  readonly attachments?: ChatAttachmentSource;
}

export interface SendOptions {
  readonly setupGate?: SetupGate;
  /** Attachment ids the page holds for this conversation; only ready ones are used. */
  readonly attachmentIds?: readonly string[];
  /** A saved prompt's engine (Phase 5). Used for this send only, with the usual setup outcomes. */
  readonly engine?: ChatEngine;
}

const NO_FILES: ResolvedAttachments = { documents: [], imageNames: [] };

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
    /** Live scope: the transcript alone, or with the digest and session context (T2). */
    liveTranscriptSnapshot: string | LiveContextSnapshot | null,
    options: SendOptions = {},
  ): Promise<ChatSendOutcome> {
    const userText = draft.trim();
    if (this.sending || !decision.isVisible || userText === '') return { status: 'ignored' };

    // B5: the scope and the live snapshot are fixed here, not read again later.
    const scope = { ...decision };
    const live =
      liveTranscriptSnapshot !== null && typeof liveTranscriptSnapshot === 'object'
        ? { ...liveTranscriptSnapshot }
        : liveTranscriptSnapshot;
    const t = this.deps.translate;
    const userCreatedAt = this.deps.clock.now();
    const cancelSource = new CancelSource();
    this.cancelSource = cancelSource;
    this.sending = true;
    this.pending = { userText, assistantText: '' };
    this.notify();

    let staged: StagedImages | null = null;
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

      // T2: the engine decides the context size, so it is resolved before packing.
      const resolution =
        options.engine === undefined
          ? await this.deps.providers.resolve()
          : await this.deps.providers.resolve(options.engine);
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

      const lastUserTurn = prior.findLast((m) => m.role === 'user')?.text ?? '';
      const query = `${userText}\n${lastUserTurn}`;
      const context = await this.pack(scope, live, contextBudgetFor(provider.id), query);
      if (wasStopped()) return cancelled();

      const ids = options.attachmentIds ?? [];
      const source = this.deps.attachments;
      const files = ids.length > 0 && source ? await source.resolve(ids) : NO_FILES;
      if (wasStopped()) return cancelled();
      // Only CLI engines see images; the local model is text only, so it answers without them.
      const cli = isCliEngine(provider.id);
      let notice: string | null = null;
      if (files.imageNames.length > 0 && source) {
        if (cli) staged = await source.stageImages(ids);
        else notice = t('Ui_ChatAttachImagesLocal');
      }
      if (wasStopped()) return cancelled();

      const prompt = buildPrompt(
        scope.kind,
        context,
        prior.map((m) => ({ role: m.role, text: m.text })),
        userText,
        {
          answerLanguage: answerLanguageName(this.deps.uiLanguage?.()),
          priorTurns: priorTurnLimitsFor(provider.id),
          attachments: packAttachments(
            files.documents,
            attachmentBudgetFor(provider.id, context.length),
            query,
          ),
          images:
            staged === null
              ? null
              : { names: staged.names, readFromDisk: provider.id === 'claude-code' },
        },
      );

      const answer = await this.stream(
        provider,
        prompt,
        cancelSource,
        staged === null
          ? undefined
          : { images: { directory: staged.directory, paths: staged.paths } },
      );
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
      return { status: 'sent', user, assistant, notice };
    } catch (error) {
      if (wasStopped() || isCancellation(error)) return cancelled();
      return fail(sendFailedFailure(error, t));
    } finally {
      // The image copies live for one send only.
      await staged?.release();
      this.sending = false;
      this.pending = null;
      this.cancelSource = null;
      this.notify();
    }
  }

  private async pack(
    scope: ChatScopeDecision,
    live: string | LiveContextSnapshot | null,
    budget: ContextBudget,
    query: string,
  ): Promise<string> {
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
      { budget, query },
    );
  }

  private async stream(
    provider: ChatStreamProvider,
    prompt: string,
    cancelSource: CancelSource,
    options?: ChatPromptOptions,
  ): Promise<string> {
    const coalescer = new StreamCoalescer(this.deps.clock, (text) => {
      if (cancelSource.cancelled || this.pending === null) return;
      this.pending = { userText: this.pending.userText, assistantText: text };
      this.notify();
    });
    const clock = this.deps.clock;
    const started = clock.now().getTime();
    let firstChunkMs: number | null = null;
    let chunks = 0;
    try {
      // S8: a send without images passes no options at all.
      const pieces =
        options === undefined
          ? provider.streamPrompt(prompt, cancelSource.signal)
          : provider.streamPrompt(prompt, cancelSource.signal, options);
      for await (const chunk of pieces) {
        if (cancelSource.cancelled) break;
        firstChunkMs ??= clock.now().getTime() - started;
        chunks += 1;
        coalescer.append(chunk);
      }
      if (!cancelSource.cancelled) coalescer.flush();
      return coalescer.text;
    } finally {
      this.deps.logger?.info('chat answer streamed', {
        firstChunkMs,
        totalMs: clock.now().getTime() - started,
        chunks,
        chars: coalescer.text.length,
      });
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
