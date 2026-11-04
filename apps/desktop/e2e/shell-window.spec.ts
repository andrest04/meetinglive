import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

// The shell window in the real app on the fake native build: geometry, saved state, no menu bar,
// Ctrl+R, tray start up, and a second launch handing over to the first.

const desktopDir = path.resolve(__dirname, '..');
const entry = path.join(desktopDir, 'out', 'main', 'index.js');

test.describe.configure({ timeout: 90_000 });

/** The app can still hold its data folder for a moment after it exits on Windows. */
function removeQuietly(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // A leftover temp folder is harmless.
  }
}

/**
 * Electron rounds the first size by a few pixels on a fractional display scale (1183 x 762
 * was seen for 1180 x 760), so the default size is compared within that rounding.
 */
function near(actual: number | undefined, expected: number): void {
  expect(Math.abs((actual ?? 0) - expected)).toBeLessThanOrEqual(4);
}

test('opens at 1180 x 760 with a 960 x 680 minimum, titled Vozella, without a menu bar', async () => {
  const launched = await launchApp();
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    const facts = await launched.app.evaluate(({ BrowserWindow, Menu }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('no window');
      const bounds = win.getNormalBounds();
      return {
        width: bounds.width,
        height: bounds.height,
        min: win.getMinimumSize(),
        title: win.getTitle(),
        menu: Menu.getApplicationMenu() === null,
      };
    });
    near(facts.width, 1180);
    near(facts.height, 760);
    expect({ min: facts.min, title: facts.title, menu: facts.menu }).toEqual({
      min: [960, 680],
      title: 'Vozella',
      menu: true,
    });
  } finally {
    await launched.close();
  }
});

// Playwright key events reach the page, not the native menu accelerators, so this test passes
// with or without the default menu (checked by removing the fix). The discriminating proof that
// the reload accelerator is gone is `Menu.getApplicationMenu() === null` in the first test.
test('Ctrl+R on the Record page is not a page reload', async () => {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1' });
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    // The menu accelerators only act on a shown, focused window.
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await page.evaluate(() => {
      (window as unknown as { survivor: number }).survivor = 1;
    });
    await page.keyboard.press('Control+R');
    await page.waitForTimeout(800);
    const survivor = await page.evaluate(
      () => (window as unknown as { survivor?: number }).survivor,
    );
    expect(survivor).toBe(1);
  } finally {
    await launched.close();
  }
});

test('restores the saved geometry and writes it again on close', async () => {
  const stateFile = (root: string): string => path.join(root, 'app', 'window-state.json');
  const launched = await launchApp({}, (root) => {
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    fs.writeFileSync(
      stateFile(root),
      JSON.stringify({ x: 30, y: 40, width: 1100, height: 720, maximized: false }),
    );
  });
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    const before = await launched.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('no window');
      return win.getNormalBounds();
    });
    expect([before.x, before.y]).toEqual([30, 40]);
    near(before.width, 1100);
    near(before.height, 720);

    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: 60, y: 70, width: 1000, height: 700 });
    });
    await launched.app.close();
    const saved = JSON.parse(fs.readFileSync(stateFile(launched.dataRoot), 'utf8')) as unknown;
    const state = saved as {
      x: number;
      y: number;
      width: number;
      height: number;
      maximized: boolean;
    };
    expect([state.x, state.y, state.maximized]).toEqual([60, 70, false]);
    near(state.width, 1000);
    near(state.height, 700);
  } finally {
    removeQuietly(launched.dataRoot);
  }
});

test('a corrupt window-state file opens the default window', async () => {
  const launched = await launchApp({}, (root) => {
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'app', 'window-state.json'), '{ not json');
  });
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    const size = await launched.app.evaluate(({ BrowserWindow }) => {
      const bounds = BrowserWindow.getAllWindows()[0]?.getNormalBounds();
      return [bounds?.width, bounds?.height];
    });
    near(size[0], 1180);
    near(size[1], 760);
  } finally {
    await launched.close();
  }
});

test('starts with the tray enabled', async () => {
  const launched = await launchApp({ VOZELLA_E2E_TRAY: '1' });
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
  } finally {
    await launched.close();
  }
});

test('a second launch exits and brings the first window back from minimized', async () => {
  const launched = await launchApp();
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });
    expect(
      await launched.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.isMinimized(),
      ),
    ).toBe(true);

    // The path of the Electron binary, as the launcher resolves it.
    const electronPath = await launched.app.evaluate(({ app }) => app.getPath('exe'));
    const child = spawn(electronPath, [entry, '--ignored-argument'], {
      cwd: desktopDir,
      env: {
        ...process.env,
        VOZELLA_E2E: '1',
        VOZELLA_FAKE_NATIVE: '1',
        VOZELLA_DATA_ROOT: launched.dataRoot,
      },
      stdio: 'ignore',
    });
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));
    expect(code).toBe(0);

    await expect
      .poll(() =>
        launched.app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          return win ? !win.isMinimized() && win.isVisible() : false;
        }),
      )
      .toBe(true);
  } finally {
    await launched.close();
  }
});
