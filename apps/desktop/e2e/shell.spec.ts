import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

test('navigation moves between Record, Library and Settings', async () => {
  const nav = page.getByRole('navigation');
  await nav.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
});

test('the theme override reaches the page and the window chrome', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The main process mirrored it into nativeTheme, which drives the title bar overlay and,
  // in a real window, prefers-color-scheme. (Playwright pins the media query to light.)
  const nativeTheme = () =>
    launched.app.evaluate(({ nativeTheme: theme }) => ({
      source: theme.themeSource,
      dark: theme.shouldUseDarkColors,
    }));
  await expect.poll(nativeTheme).toEqual({ source: 'dark', dark: true });

  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(nativeTheme).toEqual({ source: 'light', dark: false });
});

test('switching the language retranslates the shell', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'App language' }).click();
  await page.getByRole('option', { name: 'Español' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('link', { name: 'Biblioteca' })).toBeVisible();

  await page.getByRole('combobox', { name: /idioma/i }).click();
  await page.getByRole('option', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: 'Library' })).toBeVisible();
});

test('the sidebar handle resizes with the keyboard', async () => {
  const handle = page.getByRole('separator', { name: 'Resize navigation pane' });
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', String(before + 16));
});

for (const theme of ['light', 'dark'] as const) {
  test(`gallery has no serious accessibility violations in ${theme}`, async () => {
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await page.evaluate(() => {
      window.location.hash = '#/gallery';
    });
    await expect(page.getByTestId('gallery')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // AxeBuilder opens a second page, which Electron does not support: inject axe directly.
    await page.evaluate(axe.source);
    const results = await page.evaluate(() =>
      (window as unknown as { axe: typeof axe }).axe.run(document),
    );
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
      serious.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
      })),
    ).toEqual([]);
  });
}
