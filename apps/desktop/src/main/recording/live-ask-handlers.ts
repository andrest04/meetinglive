import {
  recordingAnswer,
  recordingAsk,
  recordingCancelAsk,
  recordingDismissQuestion,
  recordingQuestionDetected,
  recordingQuestionWithdrawn,
  type EventChannel,
  type PayloadInputOf,
} from '@vozella/contracts';
import {
  DIGEST_INPUT_CLI_CHARS,
  DIGEST_INPUT_LOCAL_CHARS,
  LiveAskSession,
  LiveQuestionTracker,
  RollingDigest,
  liveAnswerLanguageName,
  resolveLiveQuestionsMode,
  resolveSummaryLanguage,
  parseSummaryProvider,
  type CancelSignal,
  type DigestEngine,
  type SettingsStore,
  type SummaryProviderResolver,
} from '@vozella/core';
import { registerRequest, type IpcServerDeps } from '../ipc/ipc-server';
import type { LiveAskHooks } from './recording-service';

type Broadcast = <C extends EventChannel>(channel: C, payload: PayloadInputOf<C>) => void;

export interface LiveAskDeps {
  readonly settings: Pick<SettingsStore, 'load'>;
  readonly resolver: Pick<SummaryProviderResolver, 'resolveSummaryProvider'>;
  /** Asking is allowed only while a take records; title and notes feed the session context. */
  readonly recording: () => {
    readonly recording: boolean;
    readonly title: string;
    readonly notes?: string;
  };
  /**
   * True while the local model is already loaded. The rolling digest uses the local engine only
   * then: it never loads the model by itself. Unset counts as not loaded.
   */
  readonly localModelLoaded?: () => boolean;
  readonly broadcast: Broadcast;
  readonly formatFailure: (error: unknown) => string;
  readonly nowMs: () => number;
  /** Test seams for the live question detection; default to setImmediate and setTimeout. */
  readonly schedule?: (run: () => void) => void;
  readonly setTimer?: (run: () => void, ms: number) => () => void;
}

const defaultTimer = (run: () => void, ms: number): (() => void) => {
  const handle = setTimeout(run, ms);
  return () => {
    clearTimeout(handle);
  };
};

/** What the live chat packs besides the transcript (T2), read when a send starts (B5). */
export interface LiveChatContext {
  readonly digest: string | null;
  readonly title: string | null;
  readonly notes: string | null;
}

/** The live ask of one take: the session, the hooks the recording service calls, and the asks. */
export class LiveAsk {
  readonly session: LiveAskSession;
  /** Live question detection: cards for spoken questions, never answered on their own. */
  readonly questions: LiveQuestionTracker;
  /** The running summary the live chat reads (T2). */
  readonly digest: RollingDigest;
  private committedText = '';
  private providerChosen = true;

  constructor(private readonly deps: LiveAskDeps) {
    this.session = new LiveAskSession({
      loadSettings: async () => {
        const settings = await deps.settings.load();
        // B-20: the one parse rule. A blank or unparsable provider is "not chosen", never Local.
        const parsed = parseSummaryProvider(settings.selectedSummaryProvider);
        this.providerChosen = parsed !== null;
        return {
          providerKind: parsed ?? 'Local',
          language: resolveSummaryLanguage(settings),
        };
      },
      resolveProvider: async ({ kind, webSearch }) => {
        if (!this.providerChosen) return { status: 'unresolved' };
        const resolution = await deps.resolver.resolveSummaryProvider({ kind, webSearch });
        return resolution.status === 'ready'
          ? { status: 'ready', provider: resolution.provider }
          : { status: 'unresolved' };
      },
      committedText: () => this.committedText,
      // The brief came from the calendar, which was cut (owner decision 2026-11-03).
      sessionContext: () => ({ title: deps.recording().title, brief: '' }),
      publish: (state) => {
        deps.broadcast(recordingAnswer, state);
      },
      nowMs: deps.nowMs,
      formatFailure: deps.formatFailure,
      // Provider setup is a page flow; the main process cannot open it from here.
      setupWired: false,
    });
    this.digest = new RollingDigest({
      nowMs: deps.nowMs,
      engine: () => this.digestEngine(),
      complete: (prompt, cancel) => this.complete(prompt, cancel),
      setTimer: deps.setTimer ?? defaultTimer,
    });
    this.questions = new LiveQuestionTracker({
      mode: async () => resolveLiveQuestionsMode(await deps.settings.load()),
      confirm: (prompt, cancel) => this.complete(prompt, cancel),
      detected: (event) => {
        deps.broadcast(recordingQuestionDetected, event);
      },
      withdrawn: (id) => {
        deps.broadcast(recordingQuestionWithdrawn, { id });
      },
      // Off the live update: the detection runs after the transcript text is published.
      schedule: deps.schedule ?? ((run) => void setImmediate(run)),
      setTimer: deps.setTimer ?? defaultTimer,
    });
  }

  /**
   * The digest runs with a CLI engine, or with the local engine only when its model is already
   * loaded. Read before every update, so a change in Settings applies to the next one.
   */
  private async digestEngine(): Promise<DigestEngine | null> {
    const settings = await this.deps.settings.load();
    const kind = parseSummaryProvider(settings.selectedSummaryProvider);
    if (kind === null) return null;
    const language = liveAnswerLanguageName(resolveSummaryLanguage(settings));
    if (kind === 'Local') {
      return this.deps.localModelLoaded?.() === true
        ? { language, maxInputChars: DIGEST_INPUT_LOCAL_CHARS }
        : null;
    }
    return { language, maxInputChars: DIGEST_INPUT_CLI_CHARS };
  }

  /** The live chat's extra context: the digest and the session context, read at send start. */
  chatContext(): LiveChatContext {
    const take = this.deps.recording();
    const blankToNull = (value: string | undefined): string | null =>
      value === undefined || value.trim() === '' ? null : value;
    return {
      digest: this.digest.current,
      title: blankToNull(take.title),
      notes: blankToNull(take.notes),
    };
  }

  /**
   * One prompt through the selected summary engine without web search: the question check and
   * the rolling digest.
   */
  private async complete(prompt: string, cancel: CancelSignal): Promise<string> {
    const settings = await this.deps.settings.load();
    const kind = parseSummaryProvider(settings.selectedSummaryProvider);
    if (kind === null) throw new Error('no summary engine');
    const resolution = await this.deps.resolver.resolveSummaryProvider({ kind, webSearch: false });
    if (resolution.status !== 'ready') throw new Error('summary engine unavailable');
    let reply = '';
    for await (const chunk of resolution.provider.streamPrompt(prompt, cancel)) reply += chunk;
    return reply;
  }

  /** What the recording service calls on start, stop, discard and transcript updates. */
  readonly hooks: LiveAskHooks = {
    reset: () => {
      this.committedText = '';
      this.session.reset();
      this.questions.reset();
      this.digest.reset();
    },
    cancel: () => {
      this.session.cancel();
      this.questions.reset();
      this.digest.reset();
    },
    committed: (text) => {
      this.committedText = text;
      this.questions.committed(text);
      this.digest.committed(text);
    },
  };

  /** Fire and forget: the answer streams out through `recording.answer`. */
  ask(question: string, webSearch: boolean, preset: boolean): boolean {
    if (!this.deps.recording().recording || question.trim() === '') return false;
    this.session.setForceWebSearch(webSearch);
    void (preset ? this.session.askPreset(question) : this.session.ask(question));
    return true;
  }

  /** Bug 15: call when the summary provider changed, so the pill toggle follows it. */
  refreshWebSupport(): void {
    void this.session.refreshWebSupport();
  }

  /** The pill asks for the current state when its window opens. */
  republish(): void {
    this.session.republish();
  }

  /** Dismiss or Answer on a card: it leaves every window; the seen set keeps it from returning. */
  dismissQuestion(id: string): boolean {
    return this.questions.dismiss(id);
  }

  cancel(): boolean {
    const was = this.session.current.isAnswering;
    this.session.cancel();
    return was;
  }
}

export function registerLiveAskHandlers(server: IpcServerDeps, liveAsk: LiveAsk): void {
  registerRequest(server, recordingAsk, ({ question, webSearch, preset }) => ({
    accepted: liveAsk.ask(question, webSearch, preset === true),
  }));
  registerRequest(server, recordingCancelAsk, () => ({ cancelled: liveAsk.cancel() }));
  registerRequest(server, recordingDismissQuestion, ({ id }) => ({
    dismissed: liveAsk.dismissQuestion(id),
  }));
}
