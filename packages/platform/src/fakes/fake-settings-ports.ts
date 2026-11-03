import type {
  CancelSignal,
  CliPathProbe,
  HardwareProbe,
  HardwareProfile,
  LocalModelStore,
  SummaryModelInfo,
} from '@vozella/core';

/** A machine that never changes. */
export class FakeHardwareProbe implements HardwareProbe {
  constructor(
    private readonly profile: HardwareProfile = { totalRamGb: 16, gpuName: null, gpuVramGb: null },
  ) {}

  detect(): Promise<HardwareProfile> {
    return Promise.resolve(this.profile);
  }
}

/** Programs that are "installed", by name. */
export class FakeCliProbe implements CliPathProbe {
  constructor(readonly installed: Set<string> = new Set()) {}

  isOnPath(executable: string): Promise<boolean> {
    return Promise.resolve(this.installed.has(executable));
  }
}

/**
 * Models in memory. A download steps through percents without a network and can be held open so
 * a test sees it in flight.
 */
export class FakeLocalModelStore implements LocalModelStore {
  readonly files = new Set<string>();
  /** Set to a promise to keep a download running until it settles. */
  hold: Promise<void> | null = null;
  failWith: Error | null = null;

  isDownloaded(model: SummaryModelInfo): Promise<boolean> {
    return Promise.resolve(this.files.has(model.fileName));
  }

  async download(
    model: SummaryModelInfo,
    onProgress: (percent: number) => void,
    signal: CancelSignal,
  ): Promise<void> {
    for (const step of [25, 50, 75]) onProgress(step);
    if (this.hold) await this.hold;
    if (signal.cancelled) throw new Error('The download was cancelled.');
    if (this.failWith) throw this.failWith;
    onProgress(100);
    this.files.add(model.fileName);
  }

  delete(model: SummaryModelInfo): Promise<void> {
    this.files.delete(model.fileName);
    return Promise.resolve();
  }
}
