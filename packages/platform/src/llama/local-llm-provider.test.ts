import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSummaryPrompt,
  CancelSource,
  CONTEXT_TOKENS,
  parseOffsetDate,
  SAFETY_MARGIN,
  SummaryError,
  type CancelSignal,
} from '@vozella/core';
import { LlamaSidecar } from './llama-sidecar';
import { LocalLlmHost, type LocalLlmRuntime } from './local-llm-host';
import { LOCAL_SEED, LocalLlmSummaryProvider } from './local-llm-provider';
import type { ProcessGuard } from './process-guard';
import { FAKE_SERVER, pidAlive, waitUntil } from './test-fixtures/orphan-harness';

const noGuard: ProcessGuard = {
  protect: () => ({ mechanism: 'job', release: () => undefined }),
};
const NEVER: CancelSignal = new CancelSource().signal;
const recordedAt = parseOffsetDate('2026-11-02T14:00:00.0000000-05:00')!;
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

interface Info {
  argv: string[];
  pid: number;
  stats: { chatStarted: number; chatAborted: number };
  bodies: { chat: Record<string, unknown>[]; tokenize: Record<string, unknown>[] };
}

interface Setup {
  provider: LocalLlmSummaryProvider;
  host: LocalLlmHost;
  created: LlamaSidecar[];
  model: { path: string };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

function setup(
  extraArgs: string[] = ['--fake-reply-tokens', '6'],
  exists: (path: string) => boolean = () => true,
): Setup {
  const created: LlamaSidecar[] = [];
  const runtime: LocalLlmRuntime = {
    exe: process.execPath,
    gpuOffload: false,
    argsPrefix: [FAKE_SERVER],
    extraArgs,
    healthTimeoutMs: 15_000,
  };
  const host = new LocalLlmHost({
    createServer: () => {
      const sidecar = new LlamaSidecar({ guard: noGuard, healthPollMs: 25, killGraceMs: 500 });
      created.push(sidecar);
      return sidecar;
    },
    resolveRuntime: async () => runtime,
  });
  const model = { path: 'C:/models/a.gguf' };
  const provider = new LocalLlmSummaryProvider({
    host,
    modelPath: () => model.path,
    fileExists: async (path) => exists(path),
  });
  cleanups.push(() => host.dispose());
  return { provider, host, created, model };
}

function portOf(sidecar: LlamaSidecar): number {
  return (sidecar as unknown as { running: { port: number } }).running.port;
}

async function infoOf(sidecar: LlamaSidecar): Promise<Info> {
  const response = await fetch(`http://127.0.0.1:${portOf(sidecar)}/__info`);
  return (await response.json()) as Info;
}

describe('LocalLlmSummaryProvider without a model file', () => {
  const request = { transcript: 'hola', title: 'T', recordedAt, outputLanguage: 'es' };

  it('throws LocalModelMissing before any server starts, for every entry point', async () => {
    const { provider, created } = setup(undefined, () => false);
    const calls: (() => Promise<unknown>)[] = [
      () => provider.summarize(request, NEVER),
      () => provider.completePrompt('hi', NEVER),
      async () => {
        const chunks: string[] = [];
        for await (const chunk of provider.streamPrompt('hi', NEVER)) chunks.push(chunk);
      },
    ];
    for (const call of calls) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SummaryError);
      expect((error as SummaryError).code).toBe('LocalModelMissing');
    }
    expect(created).toHaveLength(0);
  });

  it('dispose before any load does not throw', async () => {
    const { provider } = setup();
    await expect(provider.dispose()).resolves.toBeUndefined();
    await expect(provider.dispose()).resolves.toBeUndefined();
  });
});

describe('LocalLlmSummaryProvider server lifetime (B3)', () => {
  it('loads one server for concurrent first calls and reuses it afterwards', async () => {
    const { provider, created } = setup();
    await Promise.all([
      provider.completePrompt('one', NEVER),
      provider.completePrompt('two', NEVER),
    ]);
    await provider.completePrompt('three', NEVER);
    expect(created).toHaveLength(1);
    expect((await infoOf(created[0]!)).stats.chatStarted).toBe(3);
  });

  it('stops the old server when the selected model changes and starts one for the new path', async () => {
    const { provider, created, model, host } = setup();
    await provider.completePrompt('one', NEVER);
    const firstPid = created[0]!.pid!;
    model.path = 'C:/models/b.gguf';
    await provider.completePrompt('two', NEVER);
    expect(created).toHaveLength(2);
    expect(pidAlive(firstPid)).toBe(false);
    expect(pidAlive(created[1]!.pid!)).toBe(true);
    expect(host.loadedModelPath).toBe('C:/models/b.gguf');
    const argv = (await infoOf(created[1]!)).argv;
    expect(argv[argv.indexOf('-m') + 1]).toBe('C:/models/b.gguf');
  });

  it('dispose stops the server and a later call loads a fresh one', async () => {
    const { provider, created } = setup();
    await provider.completePrompt('one', NEVER);
    const pid = created[0]!.pid!;
    await provider.dispose();
    expect(await waitUntil(() => !pidAlive(pid), 5000)).toBe(true);
    await provider.completePrompt('again', NEVER);
    expect(created).toHaveLength(2);
  });

  it('a failed load is not cached: the next call tries again', async () => {
    const { provider, created } = setup(['--fake-exit-early']);
    await expect(provider.completePrompt('x', NEVER)).rejects.toMatchObject({
      code: 'exited-early',
    });
    await expect(provider.completePrompt('x', NEVER)).rejects.toMatchObject({
      code: 'exited-early',
    });
    expect(created).toHaveLength(2);
  });

  it('starts the server with one slot and the full context', async () => {
    const { provider, created } = setup();
    await provider.completePrompt('one', NEVER);
    const argv = (await infoOf(created[0]!)).argv;
    expect(argv[argv.indexOf('-np') + 1]).toBe('1');
    expect(argv[argv.indexOf('-c') + 1]).toBe(String(CONTEXT_TOKENS));
    expect(argv[argv.indexOf('-ngl') + 1]).toBe('0');
  });
});

describe('LocalLlmSummaryProvider requests', () => {
  it('sends the prompt as one user message with explicit sampling and no prompt cache', async () => {
    const { provider, created } = setup();
    await provider.completePrompt('Say hi', NEVER);
    const body = (await infoOf(created[0]!)).bodies.chat[0]!;
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hi' }]);
    expect(body).toMatchObject({
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
      min_p: 0.05,
      repeat_penalty: 1.1,
      seed: LOCAL_SEED,
      cache_prompt: false,
      stream: true,
    });
  });

  it('counts tokens with BOS added and special tokens parsed', async () => {
    const { provider, created } = setup();
    await provider.completePrompt('Say hi', NEVER);
    const tokenize = (await infoOf(created[0]!)).bodies.tokenize;
    expect(tokenize.length).toBeGreaterThan(0);
    expect(tokenize[0]).toMatchObject({ add_special: true, parse_special: true });
  });

  it('caps a short prompt answer at 2048 and a long one at the room left', async () => {
    const { provider, created } = setup();
    await provider.completePrompt('short', NEVER);
    await provider.completePrompt(words(3000), NEVER);
    const chat = (await infoOf(created[0]!)).bodies.chat;
    expect(chat[0]!.max_tokens).toBe(2048);
    // The fake counts words, so the 3000 word prompt costs 3000 tokens.
    expect(chat[1]!.max_tokens).toBe(CONTEXT_TOKENS - SAFETY_MARGIN - 3000);
  });

  it('refuses a prompt that leaves no room with PromptTooLong and sends no chat request', async () => {
    const { provider, created } = setup();
    const error = await provider.completePrompt(words(4000), NEVER).catch((e: unknown) => e);
    expect((error as SummaryError).code).toBe('PromptTooLong');
    expect((await infoOf(created[0]!)).stats.chatStarted).toBe(0);
  });

  it('reports truncated when the server stops at the cap, and not otherwise', async () => {
    const cut = setup(['--fake-reply-tokens', '6', '--fake-finish-length']);
    const seen: boolean[] = [];
    await cut.provider.completePrompt('x', NEVER, { onOutcome: (o) => seen.push(o.truncated) });
    const whole = setup();
    await whole.provider.completePrompt('x', NEVER, { onOutcome: (o) => seen.push(o.truncated) });
    expect(seen).toEqual([true, false]);
  });

  it('throws LocalEmpty when the model returns nothing', async () => {
    const { provider } = setup(['--fake-empty']);
    const error = await provider.completePrompt('x', NEVER).catch((e: unknown) => e);
    expect((error as SummaryError).code).toBe('LocalEmpty');
    const chunks: string[] = [];
    const streamError = await (async () => {
      for await (const chunk of provider.streamPrompt('x', NEVER)) chunks.push(chunk);
    })().catch((e: unknown) => e);
    expect((streamError as SummaryError).code).toBe('LocalEmpty');
  });

  it('T2: a streamed (chat) prompt reuses the prompt cache; summaries do not', async () => {
    const { provider, created } = setup();
    const chunks: string[] = [];
    for await (const chunk of provider.streamPrompt('Question', NEVER)) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(0);
    await provider.summarize(
      { transcript: 'hola', title: 'T', recordedAt, outputLanguage: 'es' },
      NEVER,
    );
    const bodies = (await infoOf(created[0]!)).bodies.chat;
    expect(bodies[0]).toMatchObject({ cache_prompt: true });
    expect(bodies.slice(1).length).toBeGreaterThan(0);
    for (const body of bodies.slice(1)) expect(body).toMatchObject({ cache_prompt: false });
  });

  it('streams deltas as they arrive and they add up to the full text', async () => {
    const { provider } = setup(['--fake-reply-tokens', '5']);
    const chunks: string[] = [];
    for await (const chunk of provider.streamPrompt('x', NEVER)) chunks.push(chunk);
    expect(chunks.length).toBe(5);
    expect(chunks.join('')).toBe('t0 t1 t2 t3 t4 ');
  });

  it('contract: the direct path sends exactly buildSummaryPrompt, in one inference', async () => {
    const { provider, created } = setup();
    const request = {
      transcript: 'Ana: hello\nLuis: hi',
      title: 'Weekly sync',
      recordedAt,
      endedAt: parseOffsetDate('2026-11-02T14:30:00.0000000-05:00'),
      outputLanguage: 'en',
      enhancement: null,
    };
    const result = await provider.summarize(request, NEVER);
    const chat = (await infoOf(created[0]!)).bodies.chat;
    expect(chat).toHaveLength(1);
    const content = (chat[0]!.messages as { content: string }[])[0]!.content;
    expect(content).toBe(buildSummaryPrompt(request));
    // The reply goes through the shared splitter, so the result is built from this one response.
    expect(result).toMatchObject({ providerId: 'local' });
    expect(result.summaryMarkdown.length).toBeGreaterThan(0);
  });

  it('B8: a streamed prompt that leaves no room fails with PromptTooLong and sends no chat request', async () => {
    const { provider, created } = setup();
    const error = await (async () => {
      const chunks: string[] = [];
      for await (const chunk of provider.streamPrompt(words(4000), NEVER)) chunks.push(chunk);
    })().catch((e: unknown) => e);
    expect((error as SummaryError).code).toBe('PromptTooLong');
    expect((await infoOf(created[0]!)).stats.chatStarted).toBe(0);
  });

  it('B9: a streamed reply cut at the cap reports truncated, a whole one does not', async () => {
    const seen: boolean[] = [];
    const cut = setup(['--fake-reply-tokens', '6', '--fake-finish-length']);
    for await (const chunk of cut.provider.streamPrompt('x', NEVER, {
      onOutcome: (o) => seen.push(o.truncated),
    })) {
      expect(chunk).toBeTypeOf('string');
    }
    const whole = setup();
    for await (const chunk of whole.provider.streamPrompt('x', NEVER, {
      onOutcome: (o) => seen.push(o.truncated),
    })) {
      expect(chunk).toBeTypeOf('string');
    }
    expect(seen).toEqual([true, false]);
  });

  it('cancelling a stream aborts the request', async () => {
    const { provider, created } = setup(['--fake-reply-tokens', '500']);
    const source = new CancelSource();
    const iterator = provider.streamPrompt('x', source.signal)[Symbol.asyncIterator]();
    await iterator.next();
    source.cancel();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    expect(
      await waitUntil(() => false, 300).then(async () => (await infoOf(created[0]!)).stats),
    ).toMatchObject({ chatAborted: 1 });
  });

  it('summarize runs the map-reduce over the server for a transcript beyond the context', async () => {
    const { provider, created } = setup(['--fake-reply-tokens', '8']);
    const transcript = Array.from({ length: 400 }, (_, i) => `${words(20)} line${i}`).join('\n');
    const result = await provider.summarize(
      { transcript, title: 'T', recordedAt, outputLanguage: 'en' },
      NEVER,
    );
    expect(result.providerId).toBe('local');
    expect(result.summaryMarkdown.length).toBeGreaterThan(0);
    const chat = (await infoOf(created[0]!)).bodies.chat;
    expect(chat.length).toBeGreaterThan(2);
    expect(chat.at(-1)).toMatchObject({ max_tokens: 1024, temperature: 0.3 });
    expect(chat[0]).toMatchObject({ max_tokens: 640 });
  }, 60_000);
});
