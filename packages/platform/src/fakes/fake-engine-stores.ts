import {
  FakeModelStore,
  FakeRuntimeStore,
  TranscriptionCancelledError,
  type AsrBackend,
  type CancelSignal,
  type PinnedFile,
} from '@vozella/core';

export interface FakeEngineOptions {
  /** Pause between the four progress steps of a download. 0 finishes at once. */
  readonly stepMs: number;
  /** When set, every download ends with this message. */
  readonly failWith: string | null;
  /** The runtime and the speech model are already on disk. */
  readonly installed: boolean;
}

/** Reads the three variables the fake native build understands. Anything else is the default. */
export function fakeEngineOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): FakeEngineOptions {
  const step = Number(env.VOZELLA_FAKE_ENGINE_STEP_MS);
  return {
    stepMs: Number.isFinite(step) && step > 0 ? step : 0,
    failWith: env.VOZELLA_FAKE_ENGINE_FAIL?.trim() ? env.VOZELLA_FAKE_ENGINE_FAIL : null,
    installed: env.VOZELLA_FAKE_ENGINE_INSTALLED === '1',
  };
}

const STEPS = [0, 25, 50, 75, 100] as const;

async function walk(
  options: FakeEngineOptions,
  onProgress: (percent: number) => void,
  cancel: CancelSignal | undefined,
): Promise<void> {
  for (const percent of STEPS) {
    if (cancel?.cancelled) throw new TranscriptionCancelledError();
    onProgress(percent);
    if (options.stepMs > 0 && percent < 100) {
      await new Promise<void>((resolve) => setTimeout(resolve, options.stepMs));
    }
  }
  if (cancel?.cancelled) throw new TranscriptionCancelledError();
  if (options.failWith !== null) throw new Error(options.failWith);
}

/** The speech models in memory, downloaded in visible steps so a page can show and cancel them. */
export class SteppedModelStore extends FakeModelStore {
  constructor(private readonly options: FakeEngineOptions) {
    super();
    this.model = options.installed;
  }

  override async download(
    file: PinnedFile,
    onProgress: (percent: number) => void,
    cancel?: CancelSignal,
  ): Promise<void> {
    await walk(this.options, onProgress, cancel);
    await super.download(file, () => undefined);
  }
}

/** The NVIDIA runtimes in memory, with the same visible steps. */
export class SteppedRuntimeStore extends FakeRuntimeStore {
  constructor(private readonly options: FakeEngineOptions) {
    super();
    if (options.installed) this.ready.add('cpu');
  }

  override async download(
    backend: AsrBackend,
    onProgress: (percent: number) => void,
    cancel?: CancelSignal,
  ): Promise<void> {
    await walk(this.options, onProgress, cancel);
    await super.download(backend, () => undefined);
  }
}
