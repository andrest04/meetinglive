import fs from 'node:fs';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import {
  NEMOTRON_MODEL,
  SORTFORMER_MODEL,
  type CancelSignal,
  type EngineModelStore,
  type PinnedFile,
} from '@vozella/core';
import { downloadToFile } from '../settings/download-to-file';

export interface ModelStoreOptions {
  /** `TranscriptionModels` folder under the app data root. */
  readonly directory: string;
  /** Tests point the catalog at local files. */
  readonly files?: { readonly asr: PinnedFile; readonly diarization: PinnedFile };
  readonly fetch?: typeof fetch;
  readonly stallTimeoutMs?: number;
}

const STALL_TIMEOUT_MS = 60_000;

/** The two GGUF files of the engine in one folder. A `.part` file never counts as installed. */
export class NemotronModelStore implements EngineModelStore {
  private readonly asr: PinnedFile;
  private readonly diarization: PinnedFile;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly options: ModelStoreOptions) {
    this.asr = options.files?.asr ?? NEMOTRON_MODEL;
    this.diarization = options.files?.diarization ?? SORTFORMER_MODEL;
  }

  modelPath(): string {
    return nodePath.join(this.options.directory, this.asr.fileName);
  }

  diarizationModelPath(): string {
    return nodePath.join(this.options.directory, this.diarization.fileName);
  }

  isModelDownloaded(): boolean {
    return fs.existsSync(this.modelPath());
  }

  isDiarizationModelDownloaded(): boolean {
    return fs.existsSync(this.diarizationModelPath());
  }

  /**
   * Downloads a catalog file. Two callers for the same file share one transfer, so a Settings
   * download and the Record gate cannot delete each other's `.part` file (B17). The file is
   * checked against its SHA-256 and a broken transfer continues where it stopped (B5).
   */
  download(
    file: PinnedFile,
    onProgress: (percent: number) => void,
    cancel?: CancelSignal,
  ): Promise<void> {
    if (file.fileName !== this.asr.fileName && file.fileName !== this.diarization.fileName) {
      return Promise.reject(new Error(`${file.fileName} is not a model of the engine.`));
    }
    const running = this.inFlight.get(file.fileName);
    if (running) return running;
    const work = downloadToFile({
      url: file.url,
      target: nodePath.join(this.options.directory, file.fileName),
      onProgress,
      sha256: file.sha256,
      resume: true,
      stallTimeoutMs: this.options.stallTimeoutMs ?? STALL_TIMEOUT_MS,
      ...(cancel ? { cancel } : {}),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    }).finally(() => {
      this.inFlight.delete(file.fileName);
    });
    this.inFlight.set(file.fileName, work);
    return work;
  }

  async deleteModel(): Promise<void> {
    await fsp.rm(this.modelPath(), { force: true });
  }

  async deleteDiarizationModel(): Promise<void> {
    await fsp.rm(this.diarizationModelPath(), { force: true });
  }
}
