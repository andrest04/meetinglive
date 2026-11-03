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
 * Launches the built app (out/main/index.js, run `pnpm build` first) with fake native
 * adapters and a throwaway data root. The real MeetingLive folders are never involved.
 */
export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-e2e-'));
  const app = await electron.launch({
    args: [path.join(desktopDir, 'out', 'main', 'index.js')],
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
