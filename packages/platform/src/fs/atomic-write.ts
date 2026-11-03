import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import nodePath from 'node:path';

/** The calls an atomic write makes. Tests replace them to simulate a crash or a locked file. */
export interface AtomicFileOps {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export const realFileOps: AtomicFileOps = {
  mkdir: (path, options) => fs.mkdir(path, options),
  writeFile: async (path, data) => {
    const handle = await fs.open(path, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => fs.rename(from, to),
  unlink: (path) => fs.unlink(path),
};

export interface AtomicWriteOptions {
  readonly ops?: AtomicFileOps;
  /** Pauses between rename retries. Defaults to short real delays. */
  readonly retryDelaysMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_DELAYS = [10, 25, 50, 100, 200, 400];

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/**
 * Writes `data` to a temp file in the same folder, then renames it over `target`. A crash at
 * any point leaves either the old file or the new one, never a truncated one (B5).
 *
 * On Windows the rename can fail briefly while an antivirus scan or a reader holds the target,
 * so it is retried. The temp name ends in `.tmp`, so library scans never see it as a meeting.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const ops = options.ops ?? realFileOps;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays = options.retryDelaysMs ?? DEFAULT_DELAYS;
  const dir = nodePath.dirname(target);
  const temp = nodePath.join(
    dir,
    `.${nodePath.basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
  );

  await ops.mkdir(dir, { recursive: true });
  try {
    await ops.writeFile(temp, data);
    for (let attempt = 0; ; attempt += 1) {
      try {
        await ops.rename(temp, target);
        return;
      } catch (error) {
        const code = codeOf(error);
        const delay = delays[attempt];
        if (delay === undefined || code === undefined || !RETRYABLE.has(code)) throw error;
        await sleep(delay);
      }
    }
  } catch (error) {
    await ops.unlink(temp).catch(() => undefined);
    throw error;
  }
}
