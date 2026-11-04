import {
  recordingAnswer,
  recordingAsk,
  recordingCancelAsk,
  type EventChannel,
  type PayloadInputOf,
} from '@vozella/contracts';
import {
  LiveAskSession,
  resolveSummaryLanguage,
  parseSummaryProvider,
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
}

/** The live ask of one take: the session, the hooks the recording service calls, and the asks. */
export class LiveAsk {
  readonly session: LiveAskSession;
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
  }

  /** What the recording service calls on start, stop, discard and transcript updates. */
  readonly hooks: LiveAskHooks = {
    reset: () => {
      this.committedText = '';
      this.session.reset();
    },
    cancel: () => {
      this.session.cancel();
    },
    committed: (text) => {
      this.committedText = text;
    },
  };

  /** Fire and forget: the answer streams out through `recording.answer`. */
  ask(question: string, webSearch: boolean, preset: boolean): boolean {
    if (!this.deps.recording().recording || question.trim() === '') return false;
    this.session.setForceWebSearch(webSearch);
    void (preset ? this.session.askPreset(question) : this.session.ask(question));
    return true;
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
}
