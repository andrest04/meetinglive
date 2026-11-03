import fs from 'node:fs/promises';
import nodePath from 'node:path';
import type { CliPathProbe } from '@vozella/core';

export interface PathCliProbeOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  /** Defaults to the separator of the platform. */
  readonly pathSeparator?: string;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/**
 * Is a program on PATH. Spec 2.2: on Windows each PATHEXT extension (default `.EXE;.CMD;.BAT`) is
 * tried in each non blank PATH directory; elsewhere the plain name. It reads the environment on
 * every call and does not block, so installing the CLI while Settings is open is noticed (B15).
 */
export class PathCliProbe implements CliPathProbe {
  constructor(private readonly options: PathCliProbeOptions = {}) {}

  async isOnPath(executable: string): Promise<boolean> {
    const env = this.options.env ?? process.env;
    const platform = this.options.platform ?? process.platform;
    const windows = platform === 'win32';
    const separator = this.options.pathSeparator ?? (windows ? ';' : ':');
    const pathValue = windows ? (env.PATH ?? env.Path ?? '') : (env.PATH ?? '');
    const extensions = windows ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
    for (const dir of pathValue.split(separator)) {
      if (dir.trim() === '') continue;
      for (const ext of extensions) {
        if (await isFile(nodePath.join(dir, executable + ext))) return true;
      }
    }
    return false;
  }
}
