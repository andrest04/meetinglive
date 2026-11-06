import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, seedReadySettings, type LaunchedApp } from './launch';

// The recording bar and the live canvas in the real window on the fake native build (R10).
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/recording.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/recording');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';

let launched: LaunchedApp;
let page: Page;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function shot(name: string): Promise<void> {
  if (!shots) return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, name) });
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
    return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  });
}

test.beforeAll(async () => {
  launched = await launchApp(
    { ...readyEnv, VOZELLA_E2E_SHOW: shots ? '1' : '0' },
    seedReadySettings,
  );
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 900);
  });
  await page.getByRole('link', { name: 'Record' }).click();
  await installEngine(page);
  await page.getByRole('link', { name: 'Record' }).click();
});

test.afterAll(async () => {
  await page.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
});

test('a take shows the bar with the clock, the title and the sources, and no canvas before', async () => {
  await expect(page.getByTestId('live-canvas')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Title' }).fill('Weekly sync');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const bar = page.getByTestId('recording-bar');
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar.getByTestId('bar-title')).toHaveText('Weekly sync');
  await expect(bar.getByTestId('bar-sources')).toContainText('Mic:');
  await expect(bar.getByTestId('bar-sources')).toContainText('Audio:');
  const clock = bar.getByRole('timer', { name: 'Elapsed recording time' });
  await expect(clock).toHaveText(/^\d{2,}:\d{2}$/);
  await expect(clock).not.toHaveText('00:00', { timeout: 10_000 });
  await expect(bar.getByRole('meter', { name: 'Mic level' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Live transcript' })).toBeVisible();
  await expect(page.getByTestId('live-badge')).toBeVisible();
});

test('the buttons are in tab order Stop, Pause, Highlight, Copy, Discard', async () => {
  const bar = page.getByTestId('recording-bar');
  const names = await bar
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent.trim()),
    );
  expect(names).toEqual(['Stop', 'Pause', 'Highlight', 'Copy', 'Discard']);
});

test('live text arrives line by line and a highlight puts a star on it', async () => {
  const lines = page.getByTestId('canvas-lines').locator('li');
  await expect(lines.first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Highlight' }).click();
  const feedback = page.getByTestId('highlight-feedback');
  await expect(feedback).toHaveText(/^Highlighted \d{2}:\d{2}\.\d{2}$/);
  await expect(feedback).toBeEmpty({ timeout: 5_000 });
  await expect(
    page.getByTestId('canvas-lines').getByText('Highlight', { exact: true }),
  ).not.toHaveCount(0, {
    timeout: 10_000,
  });
});

test('copy shows the Copied bar and it goes away by itself', async () => {
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Transcript copied to the clipboard.')).toBeVisible();
  await expect(page.getByText('Transcript copied to the clipboard.')).toBeHidden({
    timeout: 6_000,
  });
});

test('pause hides the LIVE badge and stops the pulse, resume brings them back', async () => {
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(page.getByTestId('live-badge')).toHaveCount(0);
  await expect(page.getByTestId('recording-bar').getByTestId('pulse')).toHaveAttribute(
    'data-active',
    'false',
  );
  await expect(page.getByRole('meter', { name: 'Mic level' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  const frozen = await page.getByRole('timer', { name: 'Elapsed recording time' }).textContent();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('timer', { name: 'Elapsed recording time' })).toHaveText(
    frozen ?? '',
  );
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByTestId('live-badge')).toBeVisible();
  await expect(page.getByTestId('recording-bar').getByTestId('pulse')).toHaveAttribute(
    'data-active',
    'true',
  );
});

test('the halo is static under reduced motion', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const halo = page.getByTestId('recording-bar').getByTestId('pulse-halo');
  await expect(halo).toHaveCSS('opacity', '0.3');
  await expect(halo).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(halo).not.toHaveCSS('animation-name', 'none');
});

test('screens in light and dark, with no serious accessibility violations', async () => {
  await expect(page.getByTestId('canvas-lines').locator('li').nth(2)).toBeVisible({
    timeout: 30_000,
  });
  for (const theme of ['light', 'dark'] as const) {
    // Switch like a user does (stored preference, then a fresh load) so no colour transition is
    // still running when axe measures the contrast.
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await expect(page.getByTestId('recording-bar')).toBeVisible();
    await expect(page.getByTestId('canvas-lines').locator('li').nth(2)).toBeVisible();
    expect(await serious()).toEqual([]);
    await shot(`recording-bar-${theme}.png`);
  }
});

test('Ctrl+Shift+D asks first, Keep recording leaves the take, Discard ends it', async () => {
  await page.keyboard.press('Control+Shift+D');
  const dialog = page.getByRole('dialog', { name: 'Discard this recording?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('The audio is deleted. Nothing is saved.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep recording' })).toBeFocused();
  await shot('recording-discard-dark.png');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('recording-bar')).toBeVisible();

  await page.getByRole('button', { name: 'Discard' }).click();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByTestId('recording-bar')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Recording discarded.')).toBeVisible();
  await expect(page.getByTestId('live-canvas')).toHaveCount(0);
});

test('Ctrl+R stops the take and the offline transcript replaces the live text', async () => {
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByTestId('recording-bar')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('canvas-lines').locator('li').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.keyboard.press('Control+r');
  await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 2, name: 'Transcript' })).toBeVisible();
  await expect(page.getByTestId('live-badge')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
});
