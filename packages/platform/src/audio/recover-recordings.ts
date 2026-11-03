import fs from 'node:fs';
import path from 'node:path';
import type { WavRepairStatus } from '@vozella/core';
import { repairWavFile } from './wav-files';

export interface RecoveryReport {
  /** WAV files whose header a crash left at zero and that were fixed. */
  readonly repaired: readonly string[];
  /** WAV files that could not be fixed. */
  readonly failed: readonly string[];
  /** WAV files looked at. */
  readonly scanned: number;
}

/**
 * Finds recordings a crash or a kill left with an unwritten header and repairs them
 * (spec bug C5, parity 158). A consistent file is never touched. Runs at startup, off the
 * hot path: it yields between files so the app stays responsive in a large library.
 */
export async function recoverCrashedRecordings(
  root: string,
  yieldNow: () => Promise<void> = () => new Promise((resolve) => setImmediate(resolve)),
): Promise<RecoveryReport> {
  const repaired: string[] = [];
  const failed: string[] = [];
  let scanned = 0;
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.wav')) {
        scanned += 1;
        const status: WavRepairStatus = repairWavFile(full);
        if (status === 'Repaired') repaired.push(full);
        else if (status === 'Failed') failed.push(full);
        await yieldNow();
      }
    }
  }
  return { repaired, failed, scanned };
}
