import type { AsrBackend } from './asr-types';

/** Whether speaker labels will be produced (B7: the missing model is now visible). */
export type DiarizationState = 'off' | 'on' | 'model-missing';

export interface AsrBackendUsage {
  readonly backend: AsrBackend;
  /** The raw message of the CUDA failure when the CPU was used instead. */
  readonly fallbackReason: string | null;
  readonly diarization: DiarizationState;
}

export interface LiveDropSummary {
  readonly droppedMs: number;
  readonly totalMs: number;
}

/** `dropped / total * 100`, 0 when nothing was received. */
export function droppedPercent(summary: LiveDropSummary): number {
  return summary.totalMs <= 0 ? 0 : (summary.droppedMs / summary.totalMs) * 100;
}

/** The live-drop warning shows when strictly more than 5 percent was skipped. */
export const LIVE_DROP_WARNING_PERCENT = 5;

export interface BackendStatusReader {
  readonly current: AsrBackendUsage | null;
  readonly lastLiveDrops: LiveDropSummary | null;
}

/** Last backend usage and last live-drop summary of this process; null until first reported. */
export class AsrBackendStatus implements BackendStatusReader {
  private usage: AsrBackendUsage | null = null;
  private drops: LiveDropSummary | null = null;
  private readonly changed = new Set<() => void>();
  private readonly dropsChanged = new Set<() => void>();

  get current(): AsrBackendUsage | null {
    return this.usage;
  }

  get lastLiveDrops(): LiveDropSummary | null {
    return this.drops;
  }

  report(usage: AsrBackendUsage): void {
    this.usage = usage;
    for (const listener of [...this.changed]) listener();
  }

  reportLiveDrops(summary: LiveDropSummary): void {
    this.drops = summary;
    for (const listener of [...this.dropsChanged]) listener();
  }

  onChanged(listener: () => void): () => void {
    this.changed.add(listener);
    return () => this.changed.delete(listener);
  }

  onLiveDropsChanged(listener: () => void): () => void {
    this.dropsChanged.add(listener);
    return () => this.dropsChanged.delete(listener);
  }
}
