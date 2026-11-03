import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// Regenerates docs/port/screens/foundation/*.png. Opt in with VOZELLA_SCREENSHOTS=1 so a
// normal run does not rewrite tracked images. The window is shown, real pixels are captured.
test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');

const outDir = path.resolve(__dirname, '../../../docs/port/screens/foundation');

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_E2E_SHOW: '1' });
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

async function useTheme(theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

async function resizeWindow(width: number, height: number): Promise<void> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForTimeout(250);
}

for (const theme of ['light', 'dark'] as const) {
  test(`shell and gallery in ${theme}`, async () => {
    await resizeWindow(1120, 740);
    await useTheme(theme);

    await page.evaluate(() => {
      window.location.hash = '#/record';
    });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.screenshot({ path: path.join(outDir, `shell-record-${theme}.png`) });

    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
    await expect(page.getByRole('radio', { name: /dark|oscuro/i })).toBeVisible();
    await page.screenshot({ path: path.join(outDir, `shell-settings-${theme}.png`) });

    await page.evaluate(() => {
      window.location.hash = '#/library';
    });
    await expect(page.getByRole('searchbox')).toBeVisible();
    await page.screenshot({ path: path.join(outDir, `shell-library-${theme}.png`) });

    await page.evaluate(() => {
      window.location.hash = '#/gallery';
    });
    await expect(page.getByTestId('gallery')).toBeVisible();
    // The gallery scrolls inside the shell; make the window as tall as its content to capture it all.
    const height = await page.evaluate(
      () => (document.getElementById('content')?.scrollHeight ?? 1200) + 40,
    );
    await resizeWindow(1120, Math.min(height, 4000));
    await page.screenshot({ path: path.join(outDir, `gallery-${theme}.png`) });
    await resizeWindow(1120, 740);
  });
}

test('open overlays in dark', async () => {
  await useTheme('dark');
  await page.evaluate(() => {
    window.location.hash = '#/gallery';
  });
  await expect(page.getByTestId('gallery')).toBeVisible();
  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'gallery-menu-dark.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open dialog' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'gallery-dialog-dark.png') });
});
