import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  findSummaryModel,
  type CancelSignal,
  type LocalModelStore,
  type SummaryModelInfo,
} from '@vozella/core';
import { downloadToFile } from './download-to-file';

export interface FileLocalModelStoreOptions {
  /** `<app data>\SummaryModels`, the folder the WinUI app uses. */
  readonly directory: string;
  /** Tests point the download at a local server. Production uses the catalog URL. */
  readonly urlFor?: (model: SummaryModelInfo) => string;
  readonly fetch?: typeof fetch;
}

/**
 * GGUF summary models as files in one folder. The file name is the model id. A model counts as
 * downloaded only when the file has the pinned size; a download keeps its .part for a Range
 * resume after a failure and is checked (size, then SHA-256 when pinned) before the atomic move.
 */
export class FileLocalModelStore implements LocalModelStore {
  constructor(private readonly options: FileLocalModelStoreOptions) {}

  async isDownloaded(model: SummaryModelInfo): Promise<boolean> {
    const file = this.pathOf(model);
    try {
      const stat = await fs.stat(file);
      return stat.isFile() && stat.size === model.sizeBytes;
    } catch {
      return false;
    }
  }

  async download(
    model: SummaryModelInfo,
    onProgress: (percent: number) => void,
    signal: CancelSignal,
  ): Promise<void> {
    await downloadToFile({
      url: this.options.urlFor?.(model) ?? model.downloadUrl,
      target: this.pathOf(model),
      onProgress,
      cancel: signal,
      resume: true,
      expectedBytes: model.sizeBytes,
      ...(model.sha256 === undefined ? {} : { sha256: model.sha256 }),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
  }

  async delete(model: SummaryModelInfo): Promise<void> {
    await fs.rm(this.pathOf(model), { force: true });
  }

  /** Only names from the catalog become paths, so an id from the page cannot leave the folder. */
  private pathOf(model: SummaryModelInfo): string {
    if (findSummaryModel(model.fileName) === null) {
      throw new Error(`${model.fileName} is not a model in the catalog.`);
    }
    return nodePath.join(this.options.directory, model.fileName);
  }
}
