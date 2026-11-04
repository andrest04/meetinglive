import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { installEngine, launchAppInRoot, readyEnv, seedReadySettings } from './launch';

// sp-5: the shell end to end on the fake native build. Single instance, window state, tray,
// recording handoff, close gate and menu, each on its own throwaway data root that survives the
// app (so a second launch can read it). The real MeetingLive folders are never involved.
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/shell-platform.

const desktopDir = path.resolve(__dirname, '..');
const entry = path.join(desktopDir, 'out', 'main', 'index.js');
const outDir = path.resolve(__dirname, '../../../docs/port/screens/shell-platform');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const flagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-shell-flag-'));
const flag = path.join(flagDir, 'call.flag');

test.describe.configure({ mode: 'serial', timeout: 150_000 });

const roots: string[] = [];

function newRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-shell-'));
  roots.push(root);
  return root;
}

function seedReady(root: string): void {
  seedReadySettings(root);
}

test.afterAll(() => {
  fs.rmSync(flagDir, { recursive: true, force: true });
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A leftover temp folder is harmless.
    }
  }
});

function near(actual: number | undefined, expected: number, within = 4): void {
  expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(within);
}

const exited = (app: ElectronApplication): Promise<void> =>
  new Promise((resolve) => {
    const child = app.process();
    if (child.exitCode !== null) resolve();
    else child.once('exit', () => resolve());
  });

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  return page;
}

/** The sp-5 probe of test mode: tray menu model and every recording handoff event. */
interface Probe {
  trayItems: { id: string; label: string }[];
  trayTooltip: string;
  handoffEvents: {
    isRecording: boolean;
    mainWindowActive: boolean;
    showStartedHint: boolean;
    showPill: boolean;
  }[];
}

const readProbe = (app: ElectronApplication): Promise<Probe> =>
  app.evaluate(() => {
    const probe = (globalThis as unknown as Record<string, unknown>).__vozellaShellProbe as {
      trayItems: { id: string; label: string }[];
      trayTooltip: string;
      handoffEvents: Probe['handoffEvents'];
    };
    return {
      trayItems: probe.trayItems,
      trayTooltip: probe.trayTooltip,
      handoffEvents: probe.handoffEvents,
    };
  });

const mainState = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('meeting-prompt.html'),
    );
    if (!win) throw new Error('no main window');
    return { minimized: win.isMinimized(), visible: win.isVisible(), bounds: win.getBounds() };
  });

/** Opens the app on Record with the engine installed, ready for a fake take. */
async function readyOnRecord(app: ElectronApplication): Promise<Page> {
  const page = await ready(app);
  await page.getByRole('link', { name: 'Record' }).click();
  await installEngine(page);
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  return page;
}

async function startTake(page: Page, title: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

function markdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entryInDir) => {
    const full = path.join(dir, entryInDir.name);
    if (entryInDir.isDirectory()) return markdownFiles(full);
    return entryInDir.name.endsWith('.md') ? [full] : [];
  });
}

const closeMain = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => !w.isDestroyed())
      ?.close();
  });

// ---------------------------------------------------------------------------------------------
// Single instance and activation (items 10, 11, 7.3a)

test('a second launch on the same data root exits and the first window comes back from minimized', async () => {
  const root = newRoot();
  const app = await launchAppInRoot(root);
  try {
    await ready(app);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
    expect((await mainState(app)).minimized).toBe(true);

    const electronPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('exe'));
    const child = spawn(electronPath, [entry, '--ignored-argument'], {
      cwd: desktopDir,
      env: {
        ...process.env,
        VOZELLA_E2E: '1',
        VOZELLA_FAKE_NATIVE: '1',
        VOZELLA_DATA_ROOT: root,
      },
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);

    await expect
      .poll(async () => {
        const state = await mainState(app);
        return !state.minimized && state.visible;
      })
      .toBe(true);
    // One app, one window: the second launch created nothing.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Window state (items 16, 17, 7.3c)

test('moved and resized bounds come back on the next launch, and the minimum size holds', async () => {
  const root = newRoot();
  const first = await launchAppInRoot(root);
  try {
    await ready(first);
    await first.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 90, y: 60, width: 1040, height: 710 });
    });
    // Below the minimum: the window refuses to get smaller than 960 x 680.
    await first.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(500, 300);
    });
    const squeezed = await mainState(first);
    expect(squeezed.bounds.width).toBeGreaterThanOrEqual(960);
    expect(squeezed.bounds.height).toBeGreaterThanOrEqual(680);
    await first.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 90, y: 60, width: 1040, height: 710 });
    });
  } finally {
    await first.close();
  }

  const second = await launchAppInRoot(root);
  try {
    await ready(second);
    const bounds = (await mainState(second)).bounds;
    expect([bounds.x, bounds.y]).toEqual([90, 60]);
    near(bounds.width, 1040);
    near(bounds.height, 710);
  } finally {
    await second.close();
  }
});

test('bounds saved off every screen fall back to the default window on a visible display', async () => {
  const root = newRoot();
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', 'window-state.json'),
    JSON.stringify({ x: 40_000, y: 40_000, width: 1100, height: 720, maximized: false }),
  );
  const app = await launchAppInRoot(root);
  try {
    await ready(app);
    const facts = await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('no window');
      const bounds = win.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return { bounds, area, areas: screen.getAllDisplays().map((d) => d.workArea) };
    });
    const { bounds } = facts;
    const onSomeDisplay = facts.areas.some(
      (a) =>
        bounds.x >= a.x - 8 &&
        bounds.y >= a.y - 8 &&
        bounds.x + bounds.width <= a.x + a.width + 8 &&
        bounds.y + bounds.height <= a.y + a.height + 8,
    );
    expect(onSomeDisplay).toBe(true);
    near(bounds.width, Math.min(1180, facts.area.width), 8);
    near(bounds.height, Math.min(760, facts.area.height), 8);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Tray (7.3b) through the probe of test mode

test('the tray has Open and Quit, Open restores a minimized window, Quit still asks first', async () => {
  const root = newRoot();
  seedReady(root);
  const app = await launchAppInRoot(root, { ...readyEnv, VOZELLA_E2E_TRAY: '1' });
  try {
    const page = await readyOnRecord(app);
    const probe = await readProbe(app);
    expect(probe.trayItems.map((i) => i.id)).toEqual(['open', 'quit']);
    expect(probe.trayItems.map((i) => i.label)).toEqual(['Open Vozella', 'Quit Vozella']);
    expect(probe.trayTooltip).toBe('Vozella');

    const runTray = (id: string) =>
      app.evaluate((_electron, action) => {
        const probeObject = (globalThis as unknown as Record<string, unknown>)
          .__vozellaShellProbe as { trayRun?: (id: string) => void };
        probeObject.trayRun?.(action);
      }, id);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
    expect((await mainState(app)).minimized).toBe(true);
    await runTray('open');
    await expect
      .poll(async () => {
        const state = await mainState(app);
        return !state.minimized && state.visible;
      })
      .toBe(true);

    // A take in progress: Quit asks like every other exit, and keeping the take keeps the app.
    await startTake(page, 'Tray quit');
    expect((await readProbe(app)).trayTooltip).toBe('Vozella, recording');
    await runTray('quit');
    const dialog = page.getByRole('dialog', { name: 'Stop recording before closing?' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Keep recording' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await page
      .evaluate(() => window.vozella.invoke('recording.discard', {}))
      .catch(() => undefined);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Recording handoff (items 76 to 78, 62, 77)

test('starting a take minimizes the main window once, dismisses the popup and tells the pill seam', async () => {
  const root = newRoot();
  seedReady(root);
  fs.rmSync(flag, { force: true });
  const app = await launchAppInRoot(root, { ...readyEnv, VOZELLA_FAKE_CALL_FLAG: flag });
  try {
    const page = await readyOnRecord(app);

    // A call is on: the "Meeting detected" popup shows (the watcher polls every 5 s).
    fs.writeFileSync(flag, '');
    const popupVisible = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.webContents.getURL().includes('meeting-prompt.html') && w.isVisible(),
        ),
      );
    await expect.poll(popupVisible, { timeout: 25_000 }).toBe(true);

    expect((await readProbe(app)).handoffEvents.filter((e) => e.showStartedHint)).toHaveLength(0);
    await startTake(page, 'Handoff check');

    await expect.poll(async () => (await mainState(app)).minimized).toBe(true);
    await expect.poll(popupVisible).toBe(false);

    const afterStart = await readProbe(app);
    const hints = afterStart.handoffEvents.filter((e) => e.showStartedHint);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ isRecording: true, mainWindowActive: false, showPill: true });
    const last = afterStart.handoffEvents.at(-1);
    expect(last).toMatchObject({ isRecording: true, mainWindowActive: false });

    // Pause and resume leave the window alone: bring it back and see it stay.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (w) => !w.webContents.getURL().includes('meeting-prompt.html'),
      );
      win?.restore();
      win?.show();
    });
    await expect.poll(async () => (await mainState(app)).minimized).toBe(false);
    await page.keyboard.press('Control+p');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Control+p');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });
    expect((await mainState(app)).minimized).toBe(false);

    // Stop does not minimize either, and the seam reports the take is over.
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    expect((await mainState(app)).minimized).toBe(false);
    const afterStop = await readProbe(app);
    expect(afterStop.handoffEvents.filter((e) => e.showStartedHint)).toHaveLength(1);
    expect(afterStop.handoffEvents.at(-1)).toMatchObject({ isRecording: false, showPill: false });
  } finally {
    fs.rmSync(flag, { force: true });
    await app.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Close gate (items 90 to 101, bug 8)

test('closing during Recording asks, Keep recording keeps the take, Stop and save saves it', async () => {
  const root = newRoot();
  seedReady(root);
  const app = await launchAppInRoot(root, readyEnv);
  try {
    const page = await readyOnRecord(app);
    await startTake(page, 'Gate recording');
    await closeMain(app);
    const dialog = page.getByRole('dialog', { name: 'Stop recording before closing?' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Keep recording' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();

    await closeMain(app);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Stop and save' }).click();
    await exited(app);
    expect(markdownFiles(root).length).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

// The Preparing window of a fake start is a few milliseconds, so this close races the start. Either
// ordering must end in the same safe place: the guard waits for the start, then saves (or asks
// first when the take is already recording), and the take is on disk. The deterministic Preparing proof is the unit set in recording-service.test.ts (item 101).
test('closing right after Record never loses the take', async () => {
  const root = newRoot();
  seedReady(root);
  const app = await launchAppInRoot(root, readyEnv);
  try {
    const page = await readyOnRecord(app);
    await page.getByRole('textbox', { name: 'Title' }).fill('Gate preparing');
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await closeMain(app);
    const dialog = page.getByRole('dialog', { name: 'Stop recording before closing?' });
    // Preparing saves without a question (sp2-D1); if the start won the race the usual question
    // comes first. Both end with the app closed and the take on disk.
    const first = await Promise.race([
      exited(app).then(() => 'closed' as const),
      dialog
        .waitFor({ timeout: 45_000 })
        .then(() => 'asked' as const)
        .catch(() => 'closed' as const),
    ]);
    if (first === 'asked') await dialog.getByRole('button', { name: 'Stop and save' }).click();
    await exited(app);
    expect(markdownFiles(root).length).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('closing while the take is stopping waits for the save and keeps the take', async () => {
  const root = newRoot();
  seedReady(root);
  const app = await launchAppInRoot(root, { ...readyEnv, VOZELLA_FAKE_ASR_OFFLINE_PUSH_MS: '300' });
  try {
    const page = await readyOnRecord(app);
    await startTake(page, 'Gate stopping');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await closeMain(app);
    // No confirmation: nothing is recording, so the guard saves and then closes by itself.
    await exited(app);
    expect(markdownFiles(root).length).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------------------------
// Menu (item 140)

test('no application menu, and Ctrl+R on Record toggles the take without reloading', async () => {
  const root = newRoot();
  seedReady(root);
  const app = await launchAppInRoot(root, { ...readyEnv, VOZELLA_E2E_SHOW: '1' });
  try {
    const page = await readyOnRecord(app);
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu() === null)).toBe(true);
    await page.evaluate(() => {
      (window as unknown as { survivor: number }).survivor = 1;
    });
    await page.getByRole('textbox', { name: 'Title' }).fill('Ctrl R');
    await page.keyboard.press('Control+r');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.evaluate(() => (window as unknown as { survivor?: number }).survivor)).toBe(
      1,
    );
    await page.keyboard.press('Control+r');
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible({
      timeout: 60_000,
    });
    expect(await page.evaluate(() => (window as unknown as { survivor?: number }).survivor)).toBe(
      1,
    );
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------------------------
// Screenshots

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

test('screenshots: the shell, the tray menu model and the startup notice, light and dark', async () => {
  test.skip(!shots, 'set VOZELLA_SCREENSHOTS=1 to capture');
  fs.mkdirSync(outDir, { recursive: true });
  const root = newRoot();
  seedReady(root);
  // A damaged legacy file makes the startup migration fail, which gives the startup notice.
  fs.writeFileSync(path.join(root, 'app', 'meetings.json'), '{ not json', 'utf8');
  const app = await launchAppInRoot(root, {
    ...readyEnv,
    VOZELLA_E2E_SHOW: '1',
    VOZELLA_E2E_TRAY: '1',
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('#NavItemRecording')).toBeAttached();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 800);
    });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(() => {
        window.sessionStorage.clear();
      });
      await setTheme(page, theme);
      const notice = page.getByRole('dialog');
      await expect(notice).toBeVisible();
      await page.screenshot({ path: path.join(outDir, `integration-startup-notice-${theme}.png`) });
      await notice.getByRole('button', { name: 'OK' }).click();
      await expect(notice).toHaveCount(0);
      await page.screenshot({ path: path.join(outDir, `integration-shell-${theme}.png`) });

      // The native menu cannot be captured; its model is drawn from the probe in a hidden window.
      const probe = await readProbe(app);
      const png = await app.evaluate(
        async ({ BrowserWindow }, input) => {
          const win = new BrowserWindow({ show: false, width: 300, height: 150 });
          const dark = input.theme === 'dark';
          const rows = input.items
            .map((item) => `<li style="padding:8px 14px;margin:0">${item.label}</li>`)
            .join('');
          const html = `<body style="margin:0;background:${dark ? '#0a0a0a' : '#ffffff'};color:${dark ? '#f5f5f5' : '#0a0a0a'};font:14px 'Segoe UI',sans-serif"><div style="padding:10px 14px;font-size:12px;opacity:.7">${input.tooltip}</div><ul style="list-style:none;padding:0;margin:0;border-top:1px solid ${dark ? '#333' : '#e5e5e5'}">${rows}</ul></body>`;
          await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          const image = await win.webContents.capturePage();
          win.destroy();
          return image.toPNG().toString('base64');
        },
        { items: probe.trayItems, tooltip: probe.trayTooltip, theme },
      );
      fs.writeFileSync(
        path.join(outDir, `tray-menu-model-${theme}.png`),
        Buffer.from(png, 'base64'),
      );
    }
  } finally {
    await app.close();
  }
});
