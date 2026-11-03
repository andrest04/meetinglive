import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

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

/** A summary model that counts as downloaded on the fake build, so only the engine is missing. */
export const READY_MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

/** Environment for a Record page that passes the setup gate once `installEngine` has run. */
export const readyEnv: Record<string, string> = {
  VOZELLA_FAKE_ENGINE_STEP_MS: '5',
  VOZELLA_FAKE_MODEL_PRESENT: READY_MODEL,
};

/** Seeds the local summary provider; use with `readyEnv`. */
export function seedReadySettings(root: string): void {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', 'settings.json'),
    JSON.stringify({ selectedSummaryProvider: 'Local', selectedSummaryModelId: READY_MODEL }),
  );
}

/**
 * Puts the fake engine on disk, the last thing the Record setup gate waits for, and reloads so the
 * Record page reads the setup again (it reads it on entry, and the window opens on Record).
 */
export async function installEngine(page: Page): Promise<void> {
  await page.evaluate(() => window.vozella.invoke('transcription.ensureEngine', {}));
  await page.reload();
  await page.getByRole('navigation').waitFor();
}
