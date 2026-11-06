import type { ChatEngine, ChatStreamProvider, ProviderId, ProviderSource } from '@vozella/core';

/**
 * E2E double only (fake native build): every chat prompt is handed to `record` before the engine
 * sees it, with the engine that answers it, so a spec can prove what reached which model
 * (attached file text, a saved prompt's engine).
 */
export function recordingProviderSource(
  source: ProviderSource,
  record: (prompt: string, engine: ProviderId | undefined) => void,
): ProviderSource {
  const wrap = (provider: ChatStreamProvider): ChatStreamProvider => ({
    ...(provider.id === undefined ? {} : { id: provider.id }),
    streamPrompt: (prompt, cancel, options) => {
      record(prompt, provider.id);
      return options === undefined
        ? provider.streamPrompt(prompt, cancel)
        : provider.streamPrompt(prompt, cancel, options);
    },
  });
  return {
    resolve: async (engine?: ChatEngine) => {
      const resolution =
        engine === undefined ? await source.resolve() : await source.resolve(engine);
      return resolution.status === 'ready'
        ? { status: 'ready', provider: wrap(resolution.provider) }
        : resolution;
    },
  };
}
