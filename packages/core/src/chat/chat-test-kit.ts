import type { CancelSignal } from '../cancel';
import type { Clock } from '../clock';
import { CancelledError, type ProviderId } from '../summaries/provider';
import {
  ChatService,
  type ChatMeetingReader,
  type ChatProviderResolution,
  type ChatStreamProvider,
  type ProviderSource,
} from './chat-service';
import type { ContextFolder, ContextMeeting } from './context-packer';
import type { ChatScopeDecision } from './scope-resolver';

/** A clock tests move by hand (core cannot import the platform fake). */
export class ManualClock implements Clock {
  private ms: number;

  constructor(start = Date.parse('2026-01-01T00:00:00.000Z')) {
    this.ms = start;
  }

  now(): Date {
    return new Date(this.ms);
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}

export const guid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

export function meetingFixture(n: number, over: Partial<ContextMeeting> = {}): ContextMeeting {
  return {
    id: guid(n),
    title: `Meeting ${n}`,
    recordedAt: '2025-03-04T10:30:00.0000000+00:00',
    folderId: null,
    summary: null,
    notes: null,
    transcript: null,
    actionItems: [],
    ...over,
  };
}

export const scopeOf = (over: Partial<ChatScopeDecision> = {}): ChatScopeDecision => ({
  isVisible: true,
  kind: 'AllMeetings',
  folderId: null,
  meetingId: null,
  ...over,
});

/** A reader over fixed lists. It records which query ran, so a test can prove B17. */
export class FakeChatMeetingReader implements ChatMeetingReader {
  readonly calls: string[] = [];
  meetings: ContextMeeting[] = [];
  folders: ContextFolder[] = [];
  failWith: unknown = null;

  private run<T>(call: string, value: () => T): Promise<T> {
    this.calls.push(call);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the double rejects with any scripted value
    if (this.failWith !== null) return Promise.reject(this.failWith);
    return Promise.resolve(value());
  }

  meetingById(id: string): Promise<ContextMeeting | null> {
    return this.run(`byId:${id}`, () => this.meetings.find((m) => m.id === id) ?? null);
  }

  meetingsInFolder(folderId: string): Promise<readonly ContextMeeting[]> {
    return this.run(`folder:${folderId}`, () =>
      this.meetings.filter((m) => m.folderId === folderId),
    );
  }

  listRecent(): Promise<readonly ContextMeeting[]> {
    return this.run('recent', () => this.meetings);
  }

  listFolders(): Promise<readonly ContextFolder[]> {
    return this.run('folders', () => this.folders);
  }
}

/** A provider that streams scripted chunks. `beforeChunk` lets a test pause or move the clock. */
export class ScriptedChatProvider implements ChatStreamProvider {
  /** The engine the service sizes the context for; unset behaves as local. */
  id: ProviderId | undefined = undefined;
  readonly prompts: string[] = [];
  chunks: string[] = [];
  failWith: unknown = null;
  /** Runs before chunk `index` is yielded. */
  beforeChunk: ((index: number) => void | Promise<void>) | null = null;

  async *streamPrompt(prompt: string, cancel: CancelSignal): AsyncIterable<string> {
    this.prompts.push(prompt);
    for (let i = 0; i < this.chunks.length; i += 1) {
      await this.beforeChunk?.(i);
      if (cancel.cancelled) throw new CancelledError();
      yield this.chunks[i] ?? '';
    }
    if (this.failWith !== null) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the double throws any scripted value
      throw this.failWith;
    }
  }
}

export class FakeProviderSource implements ProviderSource {
  resolutions = 0;
  constructor(public resolution: ChatProviderResolution) {}

  resolve(): Promise<ChatProviderResolution> {
    this.resolutions += 1;
    return Promise.resolve(this.resolution);
  }
}

export interface ChatRig {
  readonly service: ChatService;
  readonly reader: FakeChatMeetingReader;
  readonly provider: ScriptedChatProvider;
  readonly source: FakeProviderSource;
  readonly clock: ManualClock;
}

/** English strings the service asks for; unknown keys echo with their arguments. */
export const TEST_STRINGS: Readonly<Record<string, string>> = {
  Chat_SendFailed: 'Could not answer. {0}',
  Chat_EmptyAnswer: 'The answer came back empty.',
  Status_SetupCancelled: 'Setup cancelled.',
  Ui_SummaryPromptTooLong: 'The text is too long for the local summary model.',
  Ui_SummaryProviderXaiRemoved: 'Grok (xAI) is no longer available.',
  Error_CliNotSignedIn: 'Sign in to {0} first.',
  ChatMeetingNotFound: 'The meeting was not found.',
  ChatLiveTranscriptEmpty: 'The live transcript is empty.',
};

export const testTranslate = (key: string, ...args: (string | number)[]): string => {
  const template = TEST_STRINGS[key] ?? key;
  return template.replace(/\{(\d+)\}/g, (_m, i: string) => String(args[Number(i)] ?? ''));
};

export function createChatRig(): ChatRig {
  const reader = new FakeChatMeetingReader();
  const provider = new ScriptedChatProvider();
  const source = new FakeProviderSource({ status: 'ready', provider });
  const clock = new ManualClock();
  let id = 0;
  const service = new ChatService({
    meetings: reader,
    providers: source,
    clock,
    translate: testTranslate as never,
    newId: () => `id-${String((id += 1))}`,
  });
  return { service, reader, provider, source, clock };
}
