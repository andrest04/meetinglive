import { CancelSource, type CancelSignal } from '../cancel';
import type { SummaryProviderKind } from '../library/settings';
import { isCancellation, type SummaryProvider } from '../summaries/provider';
import { takeRecentWindow } from './answer-window';
import { buildLiveAnswerPrompt } from './prompt-builder';
import { buildSessionContext } from './session-context';
import { shouldUseWeb, supportsWebSearch } from './web-policy';

/** At most one publish per this many ms once the first visible text went out. */
export const LIVE_ANSWER_FLUSH_MS = 80;

/** A catalog key, or ready text (a CLI failure already in the user's language). */
export interface LiveAnswerError {
  readonly key: string | null;
  readonly text: string;
}

export interface LiveAnswerState {
  readonly isAnswering: boolean;
  readonly text: string;
  readonly error: LiveAnswerError | null;
  readonly usedWeb: boolean;
  readonly canUseWebSearch: boolean;
}

export type LiveAskResolution =
  | { readonly status: 'ready'; readonly provider: Pick<SummaryProvider, 'streamPrompt'> }
  | { readonly status: 'unresolved' };

export interface LiveAskDeps {
  loadSettings(): Promise<{
    readonly providerKind: SummaryProviderKind;
    readonly language: string | null;
  }>;
  resolveProvider(request: {
    kind: SummaryProviderKind;
    webSearch: boolean;
  }): Promise<LiveAskResolution>;
  /** The committed transcript of the take so far. */
  committedText(): string;
  sessionContext(): { readonly title: string; readonly brief: string };
  publish(state: LiveAnswerState): void;
  nowMs(): number;
  formatFailure(error: unknown): string;
  /** True when the page can open the provider setup (the message then says it was cancelled). */
  readonly setupWired: boolean;
}

const hasVisible = (text: string): boolean => text.trim() !== '';

const IDLE = { isAnswering: false, text: '', error: null, usedWeb: false } as const;

/**
 * One typed question at a time (spec 3.12). A newer ask, Stop, Discard or a new take bumps the
 * generation, so a stale answer never publishes and a cancelled one is silent.
 */
export class LiveAskSession {
  private generation = 0;
  private source: CancelSource | null = null;
  private forceWeb = false;
  private state: LiveAnswerState = { ...IDLE, canUseWebSearch: false };

  constructor(private readonly deps: LiveAskDeps) {}

  get current(): LiveAnswerState {
    return this.state;
  }

  /** The toggle. It is not reset between takes (114). */
  setForceWebSearch(value: boolean): void {
    this.forceWeb = value;
  }

  get forceWebSearch(): boolean {
    return this.forceWeb;
  }

  /** Item 116: the chips use the typed path with the prompt trimmed. */
  askPreset(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    return trimmed === '' ? Promise.resolve() : this.ask(trimmed);
  }

  async ask(question: string): Promise<void> {
    const text = question.trim();
    if (text === '') return;
    const generation = this.begin();
    const source = new CancelSource();
    this.source = source;
    this.set({ ...this.state, isAnswering: true, text: '', error: null, usedWeb: false });
    const stale = (): boolean => generation !== this.generation || source.cancelled;
    try {
      const settings = await this.deps.loadSettings();
      if (stale()) return;
      const supportsWeb = supportsWebSearch(settings.providerKind);
      this.set({ ...this.state, canUseWebSearch: supportsWeb });
      const useWeb = shouldUseWeb(supportsWeb, this.forceWeb);
      const resolution = await this.deps.resolveProvider({
        kind: settings.providerKind,
        webSearch: useWeb,
      });
      if (stale()) return;
      if (resolution.status !== 'ready') {
        const key = this.deps.setupWired ? 'Status_SetupCancelled' : 'LiveCopilot_NeedsSetup';
        this.set({ ...this.state, isAnswering: false, error: { key, text: '' } });
        return;
      }
      const context = this.deps.sessionContext();
      const prompt = buildLiveAnswerPrompt(
        text,
        takeRecentWindow(this.deps.committedText()),
        settings.language,
        buildSessionContext(context.title, context.brief),
        useWeb,
      );
      const buffer = await this.stream(resolution.provider, prompt, source.signal, stale);
      if (buffer === null) return;
      const answer = buffer.trim();
      if (answer === '') {
        this.set({
          ...this.state,
          isAnswering: false,
          text: '',
          error: { key: 'RecordPage_LiveAnswerEmpty', text: '' },
        });
        return;
      }
      this.set({ ...this.state, isAnswering: false, text: answer, error: null, usedWeb: useWeb });
    } catch (error) {
      if (stale() || isCancellation(error)) return;
      this.set({
        ...this.state,
        isAnswering: false,
        error: { key: null, text: this.deps.formatFailure(error) },
      });
    }
  }

  /** Stop and Discard (127). Silent: it only ends the answering state. */
  cancel(): void {
    this.begin();
    if (this.state.isAnswering) this.set({ ...this.state, isAnswering: false });
  }

  /** A new take: any answer goes, the web toggle stays (127, 114). */
  reset(): void {
    this.begin();
    this.set({ ...IDLE, canUseWebSearch: this.state.canUseWebSearch });
    // The toggle must know the provider before the first ask.
    void this.deps.loadSettings().then(
      (settings) => {
        const canUse = supportsWebSearch(settings.providerKind);
        if (!this.state.isAnswering && canUse !== this.state.canUseWebSearch) {
          this.set({ ...this.state, canUseWebSearch: canUse });
        }
      },
      () => undefined,
    );
  }

  private begin(): number {
    this.generation += 1;
    this.source?.cancel();
    this.source = null;
    return this.generation;
  }

  private set(state: LiveAnswerState): void {
    this.state = state;
    this.deps.publish(state);
  }

  /** Returns the whole raw buffer, or null when a newer owner took over. */
  private async stream(
    provider: Pick<SummaryProvider, 'streamPrompt'>,
    prompt: string,
    cancel: CancelSignal,
    stale: () => boolean,
  ): Promise<string | null> {
    let buffer = '';
    let seenVisible = false;
    let lastPublishMs = 0;
    for await (const chunk of provider.streamPrompt(prompt, cancel)) {
      if (stale()) return null;
      buffer += chunk;
      if (!seenVisible) {
        if (!hasVisible(chunk)) continue;
        seenVisible = true;
        lastPublishMs = this.deps.nowMs();
        this.set({ ...this.state, text: buffer.trimStart() });
      } else if (this.deps.nowMs() - lastPublishMs >= LIVE_ANSWER_FLUSH_MS) {
        lastPublishMs = this.deps.nowMs();
        this.set({ ...this.state, text: buffer.trimStart() });
      }
    }
    return stale() ? null : buffer;
  }
}
