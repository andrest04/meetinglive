import type { ChatStreamProvider, ProviderSource } from '@vozella/core';

/**
 * E2E double only (fake native build): every chat prompt is handed to `record` before the engine
 * sees it, so a spec can prove what reached the model (attached file text, for example).
 */
export function recordingProviderSource(
  source: ProviderSource,
  record: (prompt: string) => void,
): ProviderSource {
  const wrap = (provider: ChatStreamProvider): ChatStreamProvider => ({
    ...(provider.id === undefined ? {} : { id: provider.id }),
    streamPrompt: (prompt, cancel, options) => {
      record(prompt);
      return options === undefined
        ? provider.streamPrompt(prompt, cancel)
        : provider.streamPrompt(prompt, cancel, options);
    },
  });
  return {
    resolve: async () => {
      const resolution = await source.resolve();
      return resolution.status === 'ready'
        ? { status: 'ready', provider: wrap(resolution.provider) }
        : resolution;
    },
  };
}
