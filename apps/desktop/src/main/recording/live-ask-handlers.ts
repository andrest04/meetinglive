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
  LiveAskSession,
  LiveQuestionTracker,
  resolveLiveQuestionsMode,
  resolveSummaryLanguage,
  parseSummaryProvider,
  type CancelSignal,
  type SettingsStore,
  type SummaryProviderResolver,
} from '@vozella/core';
import { registerRequest, type IpcServerDeps } from '../ipc/ipc-server';
import type { LiveAskHooks } from './recording-service';

type Broadcast = <C extends EventChannel>(channel: C, payload: PayloadInputOf<C>) => void;

export interface LiveAskDeps {
  readonly settings: Pick<SettingsStore, 'load'>;
  readonly resolver: Pick<SummaryProviderResolver, 'resolveSummaryProvider'>;
  /** Asking is allowed only while a take records; the title feeds the session context. */
  readonly recording: () => { readonly recording: boolean; readonly title: string };
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

/** The live ask of one take: the session, the hooks the recording service calls, and the asks. */
export class LiveAsk {
  readonly session: LiveAskSession;
  /** Live question detection: cards for spoken questions, never answered on their own. */
  readonly questions: LiveQuestionTracker;
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
    this.questions = new LiveQuestionTracker({
      mode: async () => resolveLiveQuestionsMode(await deps.settings.load()),
      confirm: (prompt, cancel) => this.checkQuestion(prompt, cancel),
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

  /** The optional yes or no check, through the selected summary engine without web search. */
  private async checkQuestion(prompt: string, cancel: CancelSignal): Promise<string> {
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
    },
    cancel: () => {
      this.session.cancel();
      this.questions.reset();
    },
    committed: (text) => {
      this.committedText = text;
      this.questions.committed(text);
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
