import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, seedReadySettings, type LaunchedApp } from './launch';

// The in-app call bar, the Take notes path into a fake recording on Record, and the popup toggle
// in Settings, on the fake native build. No real call window exists: VOZELLA_FAKE_CALL_FLAG makes
// the scanner report a call while a flag file exists. The watcher polls every 5 s.

const flagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-call-prompt-flag-'));
const flag = path.join(flagDir, 'call.flag');
const outDir = path.resolve(__dirname, '../../../docs/port/screens/calendar-detection');
const TICK_WAIT = 20_000;

test.describe.configure({ mode: 'serial', timeout: 90_000 });

const settingsPath = (root: string): string => path.join(root, 'app', 'settings.json');

/** One key of the settings file, found without regard to case (the file may use the C# casing). */
function settingKey(file: string, key: string): unknown {
  const entries = Object.entries(
    JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>,
  );
  return entries.find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
}

test.afterAll(() => {
  fs.rmSync(flagDir, { recursive: true, force: true });
});

/** Sets the app theme the way the app stores it, and reloads so the page picks it up. */
async function useTheme(page: Page, value: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    window.localStorage.setItem('vozella.theme', next);
  }, value);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await page.evaluate(() => document.fonts.ready);
}

test.describe('call bar and take notes', () => {
  let launched: LaunchedApp;
  let page: Page;

  test.beforeAll(async () => {
    launched = await launchApp({ VOZELLA_FAKE_CALL_FLAG: flag, ...readyEnv }, seedReadySettings);
    page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await installEngine(page);
    await page.getByRole('link', { name: 'Library' }).click();
  });

  test.afterAll(async () => {
    fs.rmSync(flag, { force: true });
    await launched.close();
  });

  test('the bar appears when a call is detected and stays until closed', async () => {
    fs.writeFileSync(flag, '');
    const bar = page.locator('#InfoCallPrompt');
    await expect(bar).toBeVisible({ timeout: TICK_WAIT });
    await expect(bar.getByText('A call is happening')).toBeVisible();
    await expect(bar.getByText("Take notes in Vozella so you don't miss it.")).toBeVisible();
    await expect(bar.locator('#BtnCallPromptTakeNotes')).toHaveText('Take notes');

    // Nothing closes it by itself, and it follows the user to other pages.
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(bar).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(bar).toBeVisible();

    await bar.getByRole('button', { name: 'Close' }).click();
    await expect(bar).toHaveCount(0);
  });

  test('Take notes closes the bar, opens Record and starts a fake recording', async () => {
    // The call is still on, so wait for the call to end and begin again to get a fresh offer.
    fs.rmSync(flag, { force: true });
    await page.waitForTimeout(5500);
    await page.getByRole('link', { name: 'Library' }).click();
    fs.writeFileSync(flag, '');
    const bar = page.locator('#InfoCallPrompt');
    await expect(bar).toBeVisible({ timeout: TICK_WAIT });
    await bar.locator('#BtnCallPromptTakeNotes').click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Record' })).toBeVisible();
    await expect(page.getByTestId('recording-status')).toContainText('Recording', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();

    // One request starts one take: a second consume finds nothing pending.
    const again = await page.evaluate(() =>
      window.vozella.invoke('workspace.dispatch', { action: { type: 'consumeTakeNotes' } }),
    );
    expect(again.takeNotes?.pending).toBe(false);

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
  });

  const shots = process.env.VOZELLA_SCREENSHOTS === '1';
  for (const mode of ['light', 'dark'] as const) {
    test(`screenshot of the bar in ${mode}`, async () => {
      test.skip(!shots, 'set VOZELLA_SCREENSHOTS=1 to capture');
      await useTheme(page, mode);
      fs.rmSync(flag, { force: true });
      await page.waitForTimeout(5500);
      await page.getByRole('link', { name: 'Library' }).click();
      fs.writeFileSync(flag, '');
      const bar = page.locator('#InfoCallPrompt');
      await expect(bar).toBeVisible({ timeout: TICK_WAIT });
      await page.evaluate(() => document.fonts.ready);
      fs.mkdirSync(outDir, { recursive: true });
      await page.screenshot({ path: path.join(outDir, `call-bar-${mode}.png`) });
      await bar.getByRole('button', { name: 'Close' }).click();
    });
  }
});

test.describe('popup toggle', () => {
  test('the toggle persists across a restart and leaves other settings keys alone', async () => {
    const first = await launchApp({}, (root) => {
      fs.mkdirSync(path.dirname(settingsPath(root)), { recursive: true });
      fs.writeFileSync(
        settingsPath(root),
        JSON.stringify({ calendarNotificationsEnabled: false, disabledCalendarIds: ['cal-1'] }),
      );
    });
    const settingsFile = settingsPath(first.dataRoot);
    let saved = '';
    try {
      const page = await first.app.firstWindow();
      await page.getByRole('link', { name: 'Settings' }).click();
      const toggle = page.getByRole('switch', { name: 'Show a popup when a call starts' });
      await expect(page.getByRole('heading', { level: 2, name: 'Call detection' })).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      // Applying the saved value on first paint writes nothing.
      expect(settingKey(settingsFile, 'meetingPopupEnabled')).toBeUndefined();

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect.poll(() => settingKey(settingsFile, 'meetingPopupEnabled')).toBe(false);
      saved = fs.readFileSync(settingsFile, 'utf8');
      expect(settingKey(settingsFile, 'calendarNotificationsEnabled')).toBe(false);
      expect(settingKey(settingsFile, 'disabledCalendarIds')).toEqual(['cal-1']);

      if (process.env.VOZELLA_SCREENSHOTS === '1') {
        fs.mkdirSync(outDir, { recursive: true });
        for (const mode of ['light', 'dark'] as const) {
          await useTheme(page, mode);
          await page.getByRole('link', { name: 'Settings' }).click();
          await expect(
            page.getByRole('switch', { name: 'Show a popup when a call starts' }),
          ).toHaveAttribute('aria-checked', 'false');
          await toggle.scrollIntoViewIfNeeded();
          await page.evaluate(() => document.fonts.ready);
          await page.locator('[data-testid="call-detection-section"]').screenshot({
            path: path.join(outDir, `settings-popup-toggle-${mode}.png`),
          });
        }
      }
    } finally {
      await first.close();
    }

    const second = await launchApp({}, (root) => {
      fs.mkdirSync(path.dirname(settingsPath(root)), { recursive: true });
      fs.writeFileSync(settingsPath(root), saved);
    });
    try {
      const page = await second.app.firstWindow();
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(
        page.getByRole('switch', { name: 'Show a popup when a call starts' }),
      ).toHaveAttribute('aria-checked', 'false');
    } finally {
      await second.close();
    }
  });
});
