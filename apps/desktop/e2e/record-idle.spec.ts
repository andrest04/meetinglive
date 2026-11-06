import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import {
  installEngine,
  launchApp,
  readyEnv,
  restoreMain,
  seedReadySettings,
  type LaunchedApp,
} from './launch';

// The idle Record page in the real window on the fake native build: the action row against the
// scroll container and the floating AI launcher, keyboard focus around it, axe in both themes. Screenshots go
// to VOZELLA_RECORD_SHOTS_DIR when it is set, so a normal run writes nothing.

const shotsDir = process.env.VOZELLA_RECORD_SHOTS_DIR;

let launched: LaunchedApp;
let page: Page;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function resize(width: number, height: number): Promise<void> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const main = BrowserWindow.getAllWindows()[0];
      // The window's own minimum is 960x680; the narrow and short cases go under it on purpose.
      main?.setMinimumSize(300, 300);
      main?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(height);
}

async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.getByTestId('record-actions')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function shot(name: string): Promise<void> {
  if (!shotsDir) return;
  fs.mkdirSync(shotsDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotsDir, name) });
}

async function serious(): Promise<{ id: string; impact: string | null }[]> {
  await page.evaluate(axe.source);
  return page.evaluate(async () => {
    const api = (
      window as unknown as {
        axe: { run: () => Promise<{ violations: { id: string; impact: string | null }[] }> };
      }
    ).axe;
    const result = await api.run();
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({ id: v.id, impact: v.impact }));
  });
}

/** Where the row sits against the scroll container and the bottom of the window. */
function rowGeometry(): Promise<{
  rowTop: number;
  rowBottom: number;
  mainBottom: number;
  windowBottom: number;
  scrollable: boolean;
}> {
  return page.evaluate(() => {
    const main = document.getElementById('content');
    const row = document.querySelector('[data-testid="record-actions"]');
    if (!main || !row) throw new Error('expected the scroll container and the row');
    return {
      rowTop: row.getBoundingClientRect().top,
      rowBottom: row.getBoundingClientRect().bottom,
      mainBottom: main.getBoundingClientRect().bottom,
      windowBottom: window.innerHeight,
      scrollable: main.scrollHeight > main.clientHeight,
    };
  });
}

/**
 * The row's buttons and links that the floating AI launcher overlaps. The launcher sits at the
 * bottom right while the panel is closed and must never cover something the row asks you to press.
 */
function controlsUnderLauncher(): Promise<string[]> {
  return page.evaluate(() => {
    const launcher = document.querySelector('[data-testid="BtnAiPanelOpen"]');
    const row = document.querySelector('[data-testid="record-actions"]');
    if (!launcher || !row) throw new Error('expected the launcher and the row');
    const l = launcher.getBoundingClientRect();
    return [...row.querySelectorAll('button, a[href], input, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return r.left < l.right && r.right > l.left && r.top < l.bottom && r.bottom > l.top;
      })
      .map((el) => el.getAttribute('data-testid') ?? el.textContent?.trim() ?? el.tagName);
  });
}

const scrollMainTo = (top: number): Promise<void> =>
  page.evaluate((value) => {
    document.getElementById('content')?.scrollTo({ top: value });
  }, top);

test.beforeAll(async () => {
  launched = await launchApp(
    { VOZELLA_E2E_SHOW: shotsDir ? '1' : '0', ...readyEnv },
    seedReadySettings,
  );
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByTestId('setup-checklist')).toBeVisible({ timeout: 30_000 });
});

test.afterAll(async () => {
  await launched.close();
});

test('setup missing: the action is in view at 1196x768 and the page passes axe', async () => {
  await resize(1196, 768);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await expect(page.getByTestId('BtnSetUpToRecord')).toBeInViewport({ ratio: 1 });
    const { rowBottom, mainBottom, windowBottom } = await rowGeometry();
    expect(rowBottom).toBeLessThanOrEqual(mainBottom + 0.5);
    expect(mainBottom).toBeLessThanOrEqual(windowBottom + 0.5);
    await expect(page.getByTestId('BtnAiPanelOpen')).toBeVisible();
    expect(await controlsUnderLauncher()).toEqual([]);
    expect(await serious()).toEqual([]);
    await shot(`setup-1196x768-${theme}.png`);
  }
});

test('the title has one h1 behind it and takes a long value without overflowing', async () => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const title = page.getByRole('textbox', { name: 'Title' });
  const original = await title.inputValue();
  await title.fill('Quarterly planning with the Northwind and Fabrikam account teams '.repeat(4));
  await title.blur();
  const box = await title.boundingBox();
  const mainBox = await page.locator('#content').boundingBox();
  if (!box || !mainBox) throw new Error('expected boxes');
  expect(box.x + box.width).toBeLessThanOrEqual(mainBox.x + mainBox.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await shot('title-long-dark.png');
  await title.focus();
  await shot('title-focus-dark.png');
  await title.fill(original);
  await title.blur();
});

test('in a short window the row meets the bottom of the window, clear of the AI launcher', async () => {
  await resize(1196, 480);
  await scrollMainTo(0);
  const { scrollable, rowBottom, mainBottom, windowBottom } = await rowGeometry();
  expect(scrollable).toBe(true);
  expect(Math.abs(rowBottom - mainBottom)).toBeLessThanOrEqual(0.5);
  // No docked bar below the content any more: the content column runs to the window's bottom.
  expect(Math.abs(mainBottom - windowBottom)).toBeLessThanOrEqual(0.5);
  expect(await controlsUnderLauncher()).toEqual([]);
  // The hit test under the row's last pixel row lands on the row, not on the page behind it.
  const hit = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="record-actions"]');
    if (!row) throw new Error('expected the row');
    const rect = row.getBoundingClientRect();
    return row.contains(document.elementFromPoint(rect.left + 2, rect.bottom - 1));
  });
  expect(hit).toBe(true);
  await shot('short-scrolled-dark.png');
});

test('keyboard focus is never left behind the row', async () => {
  // Short enough that the radio below the microphone starts out under the row. Without the docked
  // chat bar the content column is taller, so the window has to be shorter than it used to be.
  await resize(1196, 300);
  await scrollMainTo(0);
  await page.getByRole('textbox', { name: 'Title' }).focus();
  const before = await page.evaluate(
    () =>
      document.querySelector('input[type=radio], [role=radio]')?.getBoundingClientRect().bottom ??
      0,
  );
  expect(before).toBeGreaterThan((await rowGeometry()).rowTop);
  let reachedRadio = false;
  for (let step = 0; step < 8 && !reachedRadio; step += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      return {
        radio:
          element?.getAttribute('role') === 'radio' || element?.getAttribute('type') === 'radio',
        bottom: element?.getBoundingClientRect().bottom ?? 0,
      };
    });
    reachedRadio = focus.radio;
    expect(focus.bottom).toBeLessThanOrEqual((await rowGeometry()).rowTop + 0.5);
  }
  expect(reachedRadio).toBe(true);
});

test('setup in a narrow window, in Spanish, and the dialog that shares the rows', async () => {
  await resize(800, 768);
  await setTheme('light');
  await expect(page.getByTestId('BtnSetUpToRecord')).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(800);
  await shot('setup-800x768-light.png');
  await resize(1196, 768);
  await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
  await expect(
    page.getByRole('heading', { level: 2, name: /Termina la configuración/ }),
  ).toBeVisible();
  await shot('setup-1196x768-es-light.png');
  await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'en-US' }));
  await expect(page.getByRole('heading', { level: 2, name: /Finish setup/ })).toBeVisible();
  await page.getByRole('button', { name: 'Set up to record' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up recording' });
  await expect(dialog.getByTestId('setup-card')).toHaveCount(3);
  await shot('setup-dialog-light.png');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Setup cancelled.')).toBeVisible();
  await shot('setup-cancelled-light.png');
});

test('ready: Record, Import and the helper are in view at 1196x768 and pass axe', async () => {
  await resize(1196, 768);
  await installEngine(page);
  await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await expect(page.getByTestId('BtnRecord')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('BtnImportAudio')).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByText('Transcript and summary are created after you stop.'),
    ).toBeVisible();
    expect(await serious()).toEqual([]);
    await shot(`ready-1196x768-${theme}.png`);
  }
});

test('a narrow window keeps the row and does not overflow', async () => {
  await resize(800, 768);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await expect(page.getByTestId('BtnRecord')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(800);
    expect(await controlsUnderLauncher()).toEqual([]);
    await shot(`ready-800x768-${theme}.png`);
  }
});

test('after a take the row stays in view below the result card and the saved transcript', async () => {
  await resize(1196, 768);
  await setTheme('dark');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await stop.click();
  await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 90_000 });
  await restoreMain(launched.app);
  await resize(1196, 768);
  await scrollMainTo(0);
  await expect(page.getByTestId('BtnRecord')).toBeInViewport({ ratio: 1 });
  expect(await serious()).toEqual([]);
  await shot('result-1196x768-dark.png');
});
