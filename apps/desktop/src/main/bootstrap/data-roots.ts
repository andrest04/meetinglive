import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveDataRoots, type DataRoots, type RunMode } from '@vozella/platform';
import type { App } from 'electron';

/** The folders the data-root guard compares against. Also used to guard a folder the user picks. */
export function resolveGuardInput(
  app: Pick<App, 'getPath'>,
  env: NodeJS.ProcessEnv,
): { localAppData: string; documents: string; tempDir: string; realpath: (p: string) => string } {
  return {
    localAppData: env.LOCALAPPDATA ?? path.join(app.getPath('home'), 'AppData', 'Local'),
    documents: app.getPath('documents'),
    tempDir: os.tmpdir(),
    realpath: (p) => fs.realpathSync.native(p),
  };
}

export interface BootstrappedPaths extends DataRoots {
  readonly logsDir: string;
}

/**
 * Resolves the data roots (throws ForbiddenDataRootError for the real MeetingLive folders)
 * and points Electron's own folders at them, so nothing is written to the default
 * %APPDATA% location. Must run before the app is ready.
 */
export function bootstrapDataRoots(
  app: Pick<App, 'getPath' | 'setPath'>,
  mode: RunMode,
  env: NodeJS.ProcessEnv,
): BootstrappedPaths {
  const roots = resolveDataRoots({ env, mode, ...resolveGuardInput(app, env) });

  const electronDir = path.join(roots.appData, 'electron');
  const logsDir = path.join(roots.appData, 'logs');
  for (const dir of [roots.appData, electronDir, logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  app.setPath('userData', electronDir);
  app.setPath('sessionData', electronDir);
  app.setPath('logs', logsDir);
  return { ...roots, logsDir };
}
