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

/** VOZELLA_E2E_BACKGROUND=1 keeps every window off-screen, so a run does not disturb the desktop. */
function builtAppArgs(): string[] {
  const main = path.join(desktopDir, 'out', 'main', 'index.js');
  return process.env.VOZELLA_E2E_BACKGROUND === '1'
    ? ['-r', path.join(desktopDir, 'e2e', 'background-windows.cjs'), main]
    : [main];
}

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
    ...(executablePath ? { executablePath, args: [] } : { args: builtAppArgs() }),
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

/**
 * Like `launchApp`, but on a data root the caller owns: closing the app leaves the folder, so a
 * second launch can read what the first one wrote (window state, single instance).
 */
export async function launchAppInRoot(
  dataRoot: string,
  extraEnv: Record<string, string> = {},
): Promise<ElectronApplication> {
  const executablePath = process.env.VOZELLA_E2E_EXECUTABLE;
  return electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: builtAppArgs() }),
    cwd: desktopDir,
    env: {
      ...process.env,
      VOZELLA_E2E: '1',
      VOZELLA_FAKE_NATIVE: '1',
      VOZELLA_DATA_ROOT: dataRoot,
      ...extraEnv,
    },
  });
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

/** True when the run drives a packaged build (pnpm test:e2e:packaged). */
export const packaged = Boolean(process.env.VOZELLA_E2E_EXECUTABLE);

/** Why a spec cannot run against a packaged build, which is production mode. */
export const NO_GALLERY = 'the component gallery route does not exist in a packaged build';
export const NO_TEST_HOOKS =
  'a packaged build is production mode, which ignores the test-only hooks';

/**
 * Screenshots of the packaged app, taken only when the run targets a packaged build
 * (VOZELLA_E2E_EXECUTABLE) and VOZELLA_PACKAGED_SHOTS=1. They go to docs/port/screens/packaged.
 */
export const packagedShots =
  process.env.VOZELLA_PACKAGED_SHOTS === '1' && Boolean(process.env.VOZELLA_E2E_EXECUTABLE);

/**
 * Starting a take minimizes the main window (the live copilot pill takes over) and a minimized
 * window paints nothing, so a screenshot taken during or after a take needs this first. It does
 * what the pill's Show button does.
 */
export async function restoreMain(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Vozella');
    if (main?.isMinimized()) main.restore();
    main?.show();
  });
}

export async function packagedShot(
  page: Page,
  name: string,
  app?: ElectronApplication,
): Promise<void> {
  if (!packagedShots) return;
  if (app) await restoreMain(app);
  const dir = path.resolve(__dirname, '../../../docs/port/screens/packaged');
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, name) });
}
