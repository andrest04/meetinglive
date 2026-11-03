import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

export interface LaunchedApp {
  readonly app: ElectronApplication;
  readonly dataRoot: string;
  close(): Promise<void>;
}

const desktopDir = path.resolve(__dirname, '..');

/**
 * Launches the built app (out/main/index.js, run `pnpm build` first), or the packaged e2e
 * variant when VOZELLA_E2E_EXECUTABLE is set, with fake native
 * adapters and a throwaway data root. The real MeetingLive folders are never involved.
 */
export async function launchApp(
  extraEnv: Record<string, string> = {},
  /** Runs before the app starts, to put files in the throwaway data root. */
  seed?: (dataRoot: string) => void,
): Promise<LaunchedApp> {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-e2e-'));
  seed?.(dataRoot);
  // VOZELLA_E2E_EXECUTABLE points at a packaged e2e-variant build (pnpm package:e2e).
  const executablePath = process.env.VOZELLA_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(executablePath
      ? { executablePath, args: [] }
      : { args: [path.join(desktopDir, 'out', 'main', 'index.js')] }),
    cwd: desktopDir,
    env: {
      ...process.env,
      VOZELLA_E2E: '1',
      VOZELLA_FAKE_NATIVE: '1',
      VOZELLA_DATA_ROOT: dataRoot,
      ...extraEnv,
    },
  });
  return {
    app,
    dataRoot,
    close: async () => {
      await app.close();
      fs.rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}
