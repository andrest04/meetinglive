import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';

/** Extracts a .zip into `destination` (created if missing). */
export type ZipExtractor = (zipPath: string, destination: string) => Promise<void>;

/**
 * Windows 10 and 11 ship bsdtar as `System32\tar.exe`, which reads zip files. It is called by
 * full path so a GNU `tar` earlier on PATH (Git for Windows) cannot take its place.
 */
export function bsdtarPath(): string {
  const root = process.env.SystemRoot ?? process.env.windir;
  return process.platform === 'win32' && root ? nodePath.join(root, 'System32', 'tar.exe') : 'tar';
}

export const extractZipWithTar: ZipExtractor = async (zipPath, destination) => {
  await fsp.mkdir(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bsdtarPath(), ['-xf', zipPath, '-C', destination], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`The archive could not be extracted (exit ${String(code)}): ${stderr.trim()}`),
        );
    });
  });
};
