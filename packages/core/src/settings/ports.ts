import type { CancelSignal } from '../cancel';
import type { HardwareProfile, SummaryModelInfo } from './summary-models';

/** Port: RAM and GPU of this machine. Adapter: SystemHardwareProbe (platform). */
export interface HardwareProbe {
  detect(): Promise<HardwareProfile>;
}

/** Port: GGUF files on disk. Adapter: FileLocalModelStore (platform). */
export interface LocalModelStore {
  isDownloaded(model: SummaryModelInfo): Promise<boolean>;
  /** Reports 0 to 100. Rejects on failure or cancel and leaves no half file behind. */
  download(
    model: SummaryModelInfo,
    onProgress: (percent: number) => void,
    signal: CancelSignal,
  ): Promise<void>;
  /** No-op when the file is not there. Rejects when the file cannot be removed. */
  delete(model: SummaryModelInfo): Promise<void>;
}

/** Port: is the program on PATH. Adapter: PathCliProbe (platform). */
export interface CliPathProbe {
  isOnPath(executable: string): Promise<boolean>;
}

/** Which controls the page may offer, because a module behind them exists. */
export interface SettingsCapabilities {
  /** Local models can be downloaded. */
  readonly localModels: boolean;
}
