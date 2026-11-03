import type { CancelSignal } from '../cancel';
import type { HardwareProfile } from '../settings/summary-models';
import type { AsrBackend } from './asr-types';
import { NEMOTRON_MODEL, SORTFORMER_MODEL } from './engine-catalog';
import { selectBackend } from './recognizer-factory';
import { RuntimeInUseError, type EngineModelStore, type RuntimeStore } from './ports';

/**
 * Which download is running. The page turns this into words in the user's language
 * (`Ui_EngineStage*`), because the English literals of the WinUI app were never translated (B25).
 */
export type InstallStage = 'runtime-cuda' | 'runtime-cpu' | 'runtime-cpu-fallback' | 'model';

export interface InstallProgress {
  readonly stage: InstallStage;
  /** 0 to 100 inside the stage; resets to 0 at each stage. */
  readonly percent: number;
  /** Position of the stage in the plan and the plan size, so one overall bar is possible (B21). */
  readonly stepIndex: number;
  readonly stepCount: number;
}

export type EngineDeletion = 'Deleted' | 'RuntimeInUse' | 'Incomplete';

export interface InstallerDeps {
  readonly models: EngineModelStore;
  readonly runtimes: RuntimeStore;
  readonly hardware: () => Promise<Pick<HardwareProfile, 'gpuName'>>;
}

/** Decides what the transcription engine needs on disk and fetches it (spec 3.8). */
export class TranscriptionEngineInstaller {
  constructor(private readonly deps: InstallerDeps) {}

  /** The model exists and at least one runtime is ready. Speaker labels are not part of it. */
  isReady(): boolean {
    const { models, runtimes } = this.deps;
    return models.isModelDownloaded() && (runtimes.isReady('cuda') || runtimes.isReady('cpu'));
  }

  /** CUDA only when preferred and its runtime is ready; else CPU if ready; else the preference. */
  async expectedBackend(): Promise<AsrBackend> {
    const preferred = selectBackend(await this.deps.hardware());
    const { runtimes } = this.deps;
    if (preferred === 'cuda' && runtimes.isReady('cuda')) return 'cuda';
    if (runtimes.isReady('cpu')) return 'cpu';
    return preferred;
  }

  /** The stages `ensure` would run now, in order. */
  async plan(): Promise<InstallStage[]> {
    const { models, runtimes } = this.deps;
    const preferred = selectBackend(await this.deps.hardware());
    const stages: InstallStage[] = [];
    if (!runtimes.isReady(preferred)) {
      stages.push(preferred === 'cuda' ? 'runtime-cuda' : 'runtime-cpu');
    }
    if (preferred === 'cuda' && !runtimes.isReady('cpu')) stages.push('runtime-cpu-fallback');
    if (!models.isModelDownloaded()) stages.push('model');
    return stages;
  }

  /**
   * Downloads what is missing: the preferred runtime, the CPU runtime as a fallback for a CUDA
   * machine, then the model. The speaker model is never fetched here.
   */
  async ensure(
    onProgress: (progress: InstallProgress) => void,
    cancel?: CancelSignal,
  ): Promise<void> {
    const stages = await this.plan();
    for (const [stepIndex, stage] of stages.entries()) {
      const report = (percent: number): void => {
        onProgress({ stage, percent, stepIndex, stepCount: stages.length });
      };
      report(0);
      switch (stage) {
        case 'runtime-cuda':
          await this.deps.runtimes.download('cuda', report, cancel);
          break;
        case 'runtime-cpu':
        case 'runtime-cpu-fallback':
          await this.deps.runtimes.download('cpu', report, cancel);
          break;
        case 'model':
          await this.deps.models.download(NEMOTRON_MODEL, report, cancel);
          break;
      }
    }
  }

  /** Downloads the speaker model on its own. */
  async ensureDiarizationModel(
    onProgress: (percent: number) => void,
    cancel?: CancelSignal,
  ): Promise<void> {
    if (this.deps.models.isDiarizationModelDownloaded()) return;
    await this.deps.models.download(SORTFORMER_MODEL, onProgress, cancel);
  }

  /**
   * Removes the runtime first (it can refuse), then the ASR model and the speaker model (B6).
   * `RuntimeInUse` keeps everything; `Incomplete` means something stayed behind.
   */
  async deleteEngine(): Promise<EngineDeletion> {
    try {
      await this.deps.runtimes.delete();
    } catch (error) {
      if (error instanceof RuntimeInUseError) return 'RuntimeInUse';
      return 'Incomplete';
    }
    // Both are attempted: a locked ASR file must not keep the speaker model on disk (B6).
    let complete = true;
    try {
      await this.deps.models.deleteModel();
    } catch {
      complete = false;
    }
    try {
      await this.deps.models.deleteDiarizationModel();
    } catch {
      complete = false;
    }
    return complete ? 'Deleted' : 'Incomplete';
  }
}
