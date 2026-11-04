import {
  CancelledError,
  CliToolError,
  summaryResultFromResponse,
  type CancelSignal,
  type CliFailureKind,
  type ProviderId,
  type SuggestTitleRequest,
  type SummarizeRequest,
  type SummaryProvider,
  type SummaryResult,
} from '@vozella/core';

export interface FakeSummaryOptions {
  /** How long a run takes. Cancel is honored every few milliseconds. */
  readonly delayMs: number;
  /** A CLI failure kind (`NotSignedIn`), any other text for `Unknown`, or null for success. */
  readonly failWith: string | null;
  /** Replaces the reply of chat prompts only (VOZELLA_FAKE_CHAT_REPLY), so e2e can script citations. */
  readonly chatReply?: string;
}

const KINDS: readonly CliFailureKind[] = [
  'NotInstalled',
  'NotSignedIn',
  'SubscriptionInactive',
  'TimedOut',
  'EmptyOutput',
  'Unknown',
];

/** VOZELLA_FAKE_SUMMARY_DELAY_MS and VOZELLA_FAKE_SUMMARY_FAIL, for e2e. */
export function fakeSummaryOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): FakeSummaryOptions {
  const delay = Number(env.VOZELLA_FAKE_SUMMARY_DELAY_MS);
  return {
    delayMs: Number.isFinite(delay) && delay > 0 ? delay : 0,
    failWith: env.VOZELLA_FAKE_SUMMARY_FAIL?.trim() ? env.VOZELLA_FAKE_SUMMARY_FAIL.trim() : null,
    ...(env.VOZELLA_FAKE_CHAT_REPLY ? { chatReply: env.VOZELLA_FAKE_CHAT_REPLY } : {}),
  };
}

/** The deterministic three-section reply every fake run produces. */
export const FAKE_SUMMARY_REPLY = [
  '## Title',
  'Fake planning meeting',
  '',
  '## Summary',
  '### Overview',
  'The team went over the plan and agreed on the next steps.',
  '',
  '## Action items',
  '- [ ] Send the notes to the team',
  '- [ ] Book the follow-up call',
].join('\n');

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * A summary provider that needs no model, no CLI and no network. The fake native build registers
 * it for every engine kind so the whole generate flow can run in e2e.
 */
export class FakeSummaryProvider implements SummaryProvider {
  readonly requests: SummarizeRequest[] = [];

  constructor(
    readonly id: ProviderId = 'local',
    private readonly options: FakeSummaryOptions = { delayMs: 0, failWith: null },
  ) {}

  async summarize(request: SummarizeRequest, cancel: CancelSignal): Promise<SummaryResult> {
    this.requests.push(request);
    return summaryResultFromResponse(this.id, await this.reply(cancel));
  }

  async suggestTitle(_request: SuggestTitleRequest, cancel: CancelSignal): Promise<string> {
    await this.reply(cancel);
    return 'Fake planning meeting';
  }

  completePrompt(_prompt: string, cancel: CancelSignal): Promise<string> {
    return this.reply(cancel, this.options.chatReply);
  }

  async *streamPrompt(_prompt: string, cancel: CancelSignal): AsyncIterable<string> {
    yield await this.reply(cancel, this.options.chatReply);
  }

  private async reply(cancel: CancelSignal, override?: string): Promise<string> {
    const deadline = Date.now() + this.options.delayMs;
    while (Date.now() < deadline) {
      if (cancel.cancelled) throw new CancelledError();
      await sleep(Math.min(20, Math.max(1, deadline - Date.now())));
    }
    if (cancel.cancelled) throw new CancelledError();
    const failure = this.options.failWith;
    if (failure !== null) {
      const kind = KINDS.find((candidate) => candidate === failure) ?? 'Unknown';
      throw new CliToolError('Fake CLI', kind, kind === 'Unknown' ? failure : null);
    }
    return override ?? FAKE_SUMMARY_REPLY;
  }
}
