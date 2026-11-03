import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_APPS } from './fake-audio-apps';
import { launchApp, type LaunchedApp } from './launch';

// Regenerates docs/port/screens/audio-capture/*.png. Opt in with VOZELLA_SCREENSHOTS=1.
test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');

const outDir = path.resolve(__dirname, '../../../docs/port/screens/audio-capture');

let launched: LaunchedApp;
let page: Page;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_E2E_SHOW: '1', VOZELLA_FAKE_AUDIO_APPS: FAKE_APPS });
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 1100);
  });
  await page.waitForTimeout(300);
});

test.afterAll(async () => {
  await launched.close();
});

async function open(hash: string, theme: 'light' | 'dark', ready: () => Promise<void>) {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
  await ready();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function shot(name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

const recordReady = async () => {
  await expect(page.getByRole('radio', { name: /Zoom Workplace/ })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Microphone' })).toContainText(/\S/);
};

for (const theme of ['light', 'dark'] as const) {
  test(`record sources in ${theme}`, async () => {
    await open('#/record', theme, recordReady);
    await shot(`record-sources-${theme}`);

    await page.getByRole('combobox', { name: 'Microphone' }).click();
    await expect(page.getByRole('option', { name: 'Test headset' })).toBeVisible();
    await shot(`record-microphone-menu-${theme}`);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Use Zoom Workplace' }).click();
    await expect(page.getByRole('radio', { name: /Zoom Workplace/ })).toBeChecked();
    await shot(`record-app-selected-${theme}`);
    await page.getByRole('radio', { name: /All system audio/ }).click();
  });

  test(`record in progress in ${theme}`, async () => {
    await open('#/record', theme, recordReady);
    await page.getByRole('textbox', { name: 'Title' }).fill('Weekly planning');
    await page.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByTestId('recording-status')).toContainText('Recording...');
    await expect
      .poll(async () =>
        Number(
          await page.getByRole('meter', { name: 'Microphone level' }).getAttribute('aria-valuenow'),
        ),
      )
      .toBeGreaterThan(0);
    await shot(`record-recording-${theme}`);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();
  });

  test(`settings microphone in ${theme}`, async () => {
    await open('#/settings', theme, async () => {
      await expect(page.getByRole('heading', { level: 2, name: 'Microphone' })).toBeVisible();
    });
    await page
      .getByTestId('microphone-section')
      .evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(`settings-microphone-${theme}`);
  });
}

test('record sources in Spanish', async () => {
  await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
  await open('#/record', 'light', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Fuentes' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Zoom Workplace/ })).toBeVisible();
  });
  await shot('record-sources-es-light');
});
