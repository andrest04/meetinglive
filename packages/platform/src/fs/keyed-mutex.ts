import nodePath from 'node:path';

/** One async mutex per key. Calls with the same key run one at a time, in order. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(work, work);
    // The chain must survive a failing task, and must not leak once idle.
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

/** Lock key for a file: absolute, and case-folded because Windows paths ignore case. */
export function lockKeyFor(file: string): string {
  const resolved = nodePath.resolve(file);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

/**
 * The process-wide lock table. Every user of `folders.json` or `settings.json` takes its lock
 * from here, so two repository instances over one file cannot interleave (B6, B17).
 */
export const fileLocks = new KeyedMutex();
