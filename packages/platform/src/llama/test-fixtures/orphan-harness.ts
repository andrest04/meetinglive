import { spawn, type ChildProcess } from 'node:child_process';
import nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
export const FAKE_SERVER = nodePath.join(here, 'fake-llama-server.mjs');

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

export interface OrphanScenario {
  readonly exe: string;
  readonly modelPath: string;
  readonly gpuLayers: 'auto' | number;
  readonly argsPrefix?: readonly string[];
  /** Path of the native addon: use the Job Object. Missing: use the watchdog. */
  readonly addonPath?: string;
  readonly startTimeoutMs?: number;
}

export interface OrphanChild {
  readonly child: ChildProcess;
  readonly serverPid: number;
}

/** Starts a Node child that owns a sidecar, and resolves once the server is ready. */
export function startOrphanChild(scenario: OrphanScenario): Promise<OrphanChild> {
  const child = spawn(
    process.execPath,
    [
      '--no-warnings',
      '--experimental-transform-types',
      '--import',
      pathToFileURL(nodePath.join(here, 'register-ts-loader.mjs')).href,
      nodePath.join(here, 'orphan-child.ts'),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        ORPHAN_EXE: scenario.exe,
        ORPHAN_MODEL: scenario.modelPath,
        ORPHAN_GPU_LAYERS: String(scenario.gpuLayers),
        ORPHAN_ARGS_PREFIX: JSON.stringify(scenario.argsPrefix ?? []),
        ...(scenario.addonPath ? { ORPHAN_ADDON_PATH: scenario.addonPath } : {}),
      },
    },
  );
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`orphan child did not report a pid: ${out} ${err}`));
    }, scenario.startTimeoutMs ?? 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const match = /PID (\d+)/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolve({ child, serverPid: Number(match[1]) });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`orphan child exited (${code}): ${out} ${err}`));
    });
  });
}
