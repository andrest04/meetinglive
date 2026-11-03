import type { CancelSignal, SummaryModelInfo } from '@vozella/core';
import { FakeLocalModelStore } from '@vozella/platform';

/** What the fake build reads from the environment to script the model folder. */
export interface FakeModelScript {
  /** Milliseconds between the progress steps; 0 finishes at once. */
  readonly stepMs: number;
  /** When set, a download fails with this message. */
  readonly failWith: string | null;
  /** How many downloads fail before one succeeds; null means every one fails. */
  readonly failCount: number | null;
  /** File names that are already on disk when the app starts. */
  readonly present: readonly string[];
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Reads the VOZELLA_FAKE_MODEL_* variables. Only the fake native build calls this. */
export function fakeModelScriptFromEnv(env: NodeJS.ProcessEnv): FakeModelScript {
  const count = Number(env.VOZELLA_FAKE_MODEL_FAIL_COUNT);
  const fail = env.VOZELLA_FAKE_MODEL_FAIL ?? '';
  return {
    stepMs: Math.max(0, Number(env.VOZELLA_FAKE_MODEL_STEP_MS) || 0),
    failWith: fail === '' ? null : fail,
    failCount: Number.isInteger(count) && count > 0 ? count : null,
    present: (env.VOZELLA_FAKE_MODEL_PRESENT ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== ''),
  };
}

/**
 * The fake model folder with a script: slow steps so a test can see and cancel a download, a
 * failure that can happen once, and files that are already there. A cancel ends the wait at the
 * next step. No network and no file is touched.
 */
export class ScriptedFakeModelStore extends FakeLocalModelStore {
  private failures = 0;

  constructor(private readonly script: FakeModelScript) {
    super();
    for (const name of script.present) this.files.add(name);
  }

  override async download(
    _model: SummaryModelInfo,
    onProgress: (percent: number) => void,
    signal: CancelSignal,
  ): Promise<void> {
    for (const step of [10, 25, 50, 75, 90]) {
      if (this.script.stepMs > 0) await wait(this.script.stepMs);
      if (signal.cancelled) throw new Error('The download was cancelled.');
      onProgress(step);
    }
    const { failWith, failCount } = this.script;
    if (failWith !== null && (failCount === null || this.failures < failCount)) {
      this.failures += 1;
      throw new Error(failWith);
    }
    onProgress(100);
    this.files.add(_model.fileName);
  }
}
