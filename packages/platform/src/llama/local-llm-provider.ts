import fs from 'node:fs/promises';
import {
  CancelledError,
  LOCAL_SAMPLING,
  PROMPT_TEMPERATURE,
  promptOutputCap,
  summarizeMapReduce,
  summaryResultFromResponse,
  SummaryError,
  type CancelSignal,
  type PromptCallOptions,
  type SummarizeRequest,
  type SummaryProvider,
  type SummaryResult,
  type TokenCounter,
} from '@vozella/core';
import { LlamaSidecarError, type ChatOptions } from './llama-sidecar';
import type { LocalLlmHost, LocalLlmServer } from './local-llm-host';

/** Every call uses this seed, so the same prompt gives the same answer (item 54). */
export const LOCAL_SEED = 1337;

export interface LocalLlmProviderOptions {
  readonly host: LocalLlmHost;
  /** The model file the settings select right now. Read on every call, so a switch is seen. */
  readonly modelPath: () => string;
  readonly fileExists?: (path: string) => Promise<boolean>;
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

interface Generation {
  readonly text: string;
  readonly truncated: boolean;
}

/** `SummaryProvider` for the local engine, on top of a lazily loaded llama-server (spec 3.5). */
export class LocalLlmSummaryProvider implements SummaryProvider {
  readonly id = 'local' as const;
  private readonly fileExists: (path: string) => Promise<boolean>;

  constructor(private readonly options: LocalLlmProviderOptions) {
    this.fileExists = options.fileExists ?? defaultFileExists;
  }

  async summarize(request: SummarizeRequest, cancel: CancelSignal): Promise<SummaryResult> {
    const server = await this.ready(cancel);
    const raw = await this.guarded(server, () =>
      summarizeMapReduce(
        request,
        this.counter(server, cancel),
        async (prompt, maxTokens, temperature, signal) =>
          (await this.infer(server, prompt, maxTokens, temperature, signal)).text,
        cancel,
      ),
    );
    return summaryResultFromResponse(this.id, raw);
  }

  async completePrompt(
    prompt: string,
    cancel: CancelSignal,
    options?: PromptCallOptions,
  ): Promise<string> {
    const server = await this.ready(cancel);
    return this.guarded(server, async () => {
      const cap = await promptOutputCap(this.counter(server, cancel), prompt);
      const result = await this.infer(server, prompt, cap, PROMPT_TEMPERATURE, cancel);
      options?.onOutcome?.({ truncated: result.truncated });
      return result.text;
    });
  }

  async *streamPrompt(
    prompt: string,
    cancel: CancelSignal,
    options?: PromptCallOptions,
  ): AsyncGenerator<string> {
    const server = await this.ready(cancel);
    let any = false;
    let truncated = false;
    try {
      const cap = await promptOutputCap(this.counter(server, cancel), prompt);
      for await (const delta of server.chatStream(
        [{ role: 'user', content: prompt }],
        this.chatOptions(PROMPT_TEMPERATURE, cap, cancel),
      )) {
        if (delta.finishReason === 'length') truncated = true;
        if (delta.content) {
          if (delta.content.trim() !== '') any = true;
          yield delta.content;
        }
      }
    } catch (error) {
      await this.noteFailure(server, error);
      throw error;
    }
    if (!any) throw new SummaryError('LocalEmpty');
    options?.onOutcome?.({ truncated });
  }

  /** Stops the server this provider uses. Safe before any model was loaded. */
  dispose(): Promise<void> {
    return this.options.host.dispose();
  }

  /** The missing-file check comes first, then the lazy single load (items 36 and 37). */
  private async ready(cancel: CancelSignal): Promise<LocalLlmServer> {
    if (cancel.cancelled) throw new CancelledError();
    const path = this.options.modelPath();
    if (!(await this.fileExists(path))) throw new SummaryError('LocalModelMissing');
    return this.options.host.acquire(path, cancel);
  }

  /** Token counts as the server sees them: BOS added, special tokens parsed (item 39). */
  private counter(server: LocalLlmServer, cancel: CancelSignal): TokenCounter {
    return {
      count: (text) => server.tokenize(text, cancel, { addSpecial: true, parseSpecial: true }),
    };
  }

  private chatOptions(temperature: number, maxTokens: number, signal: CancelSignal): ChatOptions {
    return {
      maxTokens,
      temperature,
      topP: LOCAL_SAMPLING.topP,
      topK: LOCAL_SAMPLING.topK,
      minP: LOCAL_SAMPLING.minP,
      repeatPenalty: LOCAL_SAMPLING.repeatPenalty,
      seed: LOCAL_SEED,
      cachePrompt: false,
      signal,
    };
  }

  private async infer(
    server: LocalLlmServer,
    prompt: string,
    maxTokens: number,
    temperature: number,
    cancel: CancelSignal,
  ): Promise<Generation> {
    let text = '';
    let truncated = false;
    for await (const delta of server.chatStream(
      [{ role: 'user', content: prompt }],
      this.chatOptions(temperature, maxTokens, cancel),
    )) {
      if (delta.content) text += delta.content;
      if (delta.finishReason === 'length') truncated = true;
    }
    const trimmed = text.trim();
    if (trimmed === '') throw new SummaryError('LocalEmpty');
    return { text: trimmed, truncated };
  }

  private async guarded<T>(server: LocalLlmServer, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      await this.noteFailure(server, error);
      throw error;
    }
  }

  /** A server that crashed twice is forgotten so the next call starts a fresh one. */
  private async noteFailure(server: LocalLlmServer, error: unknown): Promise<void> {
    if (
      error instanceof LlamaSidecarError &&
      (error.code === 'crashed' || error.code === 'not-running')
    ) {
      await this.options.host.invalidate(server);
    }
  }
}
