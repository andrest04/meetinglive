import { CancelSource } from '../cancel';
import type { AppSettings, SettingsStore } from '../library';
import { ignored, messageOf, type CommitOutcome } from './commands';
import type { LocalModelStore } from './ports';
import {
  findSummaryModel,
  rateFor,
  SUMMARY_MODELS,
  type FitRating,
  type HardwareProfile,
} from './summary-models';

export type ModelEvent =
  | { readonly type: 'progress'; readonly fileName: string; readonly percent: number }
  | { readonly type: 'finished'; readonly fileName: string }
  | { readonly type: 'failed'; readonly fileName: string; readonly message: string }
  | { readonly type: 'cancelled'; readonly fileName: string }
  | { readonly type: 'deleted'; readonly fileName: string };

export type DownloadOutcome =
  | { readonly status: 'done' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'ignored';
      readonly reason: 'unknown-model' | 'already-downloading' | 'already-downloaded';
    };

export type DeleteOutcome =
  | { readonly status: 'deleted'; readonly settings: AppSettings }
  | { readonly status: 'busy' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ignored'; readonly reason: 'unknown-model' };

export interface ModelRow {
  readonly fileName: string;
  readonly displayName: string;
  readonly fileSizeGb: number;
  readonly minRamGb: number;
  readonly speedKey: string;
  readonly qualityKey: string;
  readonly useCaseKey: string;
  /** Null when the hardware could not be read. */
  readonly fit: FitRating | null;
  readonly downloaded: boolean;
  /** The selected model, only while its file is there (B7). */
  readonly active: boolean;
  readonly downloading: boolean;
  /** 0 to 100 while downloading, else null. */
  readonly percent: number | null;
}

export interface ModelRows {
  readonly rows: readonly ModelRow[];
  /** A saved model id with no file or no catalog entry, so the page can say why none is active. */
  readonly missingActiveId: string | null;
}

export interface LocalModelsDeps {
  readonly store: LocalModelStore;
  readonly settings: SettingsStore;
  readonly notify: (event: ModelEvent) => void;
}

interface Transfer {
  readonly cancel: CancelSource;
  percent: number;
}

/**
 * The summary models on disk: what the Settings page lists, downloads, selects and deletes.
 * Transfers live here, not in the page, so leaving and coming back keeps their state and a second
 * download of the same file is refused (B17).
 */
export class LocalModelsService {
  private readonly transfers = new Map<string, Transfer>();

  constructor(private readonly deps: LocalModelsDeps) {}

  inFlight(): { fileName: string; percent: number }[] {
    return [...this.transfers].map(([fileName, t]) => ({ fileName, percent: t.percent }));
  }

  async rows(hardware: HardwareProfile | null): Promise<ModelRows> {
    const settings = await this.deps.settings.load();
    const selected = settings.selectedSummaryModelId;
    const rows: ModelRow[] = [];
    let selectedUsable = false;
    for (const model of SUMMARY_MODELS) {
      const downloaded = await this.deps.store.isDownloaded(model);
      const active = downloaded && model.fileName === selected;
      selectedUsable ||= active;
      const transfer = this.transfers.get(model.fileName);
      rows.push({
        fileName: model.fileName,
        displayName: model.displayName,
        fileSizeGb: model.fileSizeGb,
        minRamGb: model.minRamGb,
        speedKey: model.speedKey,
        qualityKey: model.qualityKey,
        useCaseKey: model.useCaseKey,
        fit: hardware ? rateFor(model, hardware) : null,
        downloaded,
        active,
        downloading: transfer !== undefined,
        percent: transfer ? transfer.percent : null,
      });
    }
    const missingActiveId =
      selected !== null && selected.trim() !== '' && !selectedUsable ? selected : null;
    return { rows, missingActiveId };
  }

  async download(fileName: string): Promise<DownloadOutcome> {
    const model = findSummaryModel(fileName);
    if (!model) return { status: 'ignored', reason: 'unknown-model' };
    if (this.transfers.has(fileName)) return { status: 'ignored', reason: 'already-downloading' };
    // Registered before the first await, so a second call sees it.
    const transfer: Transfer = { cancel: new CancelSource(), percent: 0 };
    this.transfers.set(fileName, transfer);
    try {
      if (await this.deps.store.isDownloaded(model)) {
        return { status: 'ignored', reason: 'already-downloaded' };
      }
      if (transfer.cancel.cancelled) return this.cancelled(fileName);
      await this.deps.store.download(
        model,
        (percent) => {
          transfer.percent = percent;
          this.deps.notify({ type: 'progress', fileName, percent });
        },
        transfer.cancel.signal,
      );
      this.deps.notify({ type: 'finished', fileName });
      return { status: 'done' };
    } catch (error) {
      if (transfer.cancel.cancelled) return this.cancelled(fileName);
      const message = messageOf(error);
      this.deps.notify({ type: 'failed', fileName, message });
      return { status: 'failed', message };
    } finally {
      this.transfers.delete(fileName);
    }
  }

  private cancelled(fileName: string): DownloadOutcome {
    this.deps.notify({ type: 'cancelled', fileName });
    return { status: 'cancelled' };
  }

  cancel(fileName: string): void {
    this.transfers.get(fileName)?.cancel.cancel();
  }

  /** Marks one downloaded model active. Reselecting the active model does nothing. */
  async select(fileName: string): Promise<CommitOutcome> {
    try {
      const model = findSummaryModel(fileName);
      if (!model || !(await this.deps.store.isDownloaded(model))) return ignored('invalid');
      const current = await this.deps.settings.load();
      if (current.selectedSummaryModelId === fileName) return ignored('unchanged');
      const settings = await this.deps.settings.update({ selectedSummaryModelId: fileName });
      return { status: 'saved', settings, feedback: null };
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
  }

  /** Removes the file. If the model was the active one the selection is cleared. */
  async delete(fileName: string): Promise<DeleteOutcome> {
    const model = findSummaryModel(fileName);
    if (!model) return { status: 'ignored', reason: 'unknown-model' };
    if (this.transfers.has(fileName)) return { status: 'busy' };
    try {
      await this.deps.store.delete(model);
      let settings = await this.deps.settings.load();
      if (settings.selectedSummaryModelId === fileName) {
        settings = await this.deps.settings.update({ selectedSummaryModelId: null });
      }
      this.deps.notify({ type: 'deleted', fileName });
      return { status: 'deleted', settings };
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
  }
}
