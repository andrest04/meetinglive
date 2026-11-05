import fs from 'node:fs';
import axe from 'axe-core';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// The Settings page in the real window, on the fake native build and a throwaway data root.
// Nothing here talks to a real CLI or the network.

let launched: LaunchedApp;
let page: Page;

const settingsFile = (): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(path.join(launched.dataRoot, 'app', 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;

async function choose(select: string | RegExp, option: string | RegExp): Promise<void> {
  await page.getByRole('combobox', { name: select }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  // The closing list stays in the page until its exit animation ends; the next choice must not
  // see it, or an option name such as English matches in two lists.
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  launched = await launchApp();
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Summary provider' })).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

test('opening the page writes nothing and shows the saved choices', async () => {
  await expect(page.getByRole('radio', { name: 'Local (on this device)' })).toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Transcription language' })).toContainText(
    'Spanish',
  );
  expect(fs.existsSync(path.join(launched.dataRoot, 'app', 'settings.json'))).toBe(false);
});

test('a local model downloads, becomes active and is removed', async () => {
  const group = page.getByRole('radiogroup', { name: 'Summary models' });
  const gemma = group.getByRole('radio', { name: /Gemma 4 E2B Instruct/ });
  await expect(gemma).toBeDisabled();
  await expect(group.getByText('Recommended').first()).toBeVisible();
  await expect(group.getByText('Download to use').first()).toBeVisible();
  await expect(group.getByText('Fast · Quality Very good · 3.1 GB download')).toBeVisible();

  const row = group
    .locator(':scope > div')
    .filter({ has: page.getByRole('radio', { name: /Gemma 4 E2B Instruct/ }) });
  await row.getByRole('button', { name: 'Download' }).click();
  await expect(gemma).toBeEnabled();
  await gemma.click();
  await expect(gemma).toBeChecked();
  await expect.poll(() => settingsFile().selectedSummaryModelId).toBe('gemma-4-E2B-it-Q4_K_M.gguf');
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(gemma).toBeDisabled();
  await expect(gemma).not.toBeChecked();
  await expect.poll(() => settingsFile().selectedSummaryModelId).toBeNull();
});

test('Claude Code shows the PATH check and saves model and effort one field at a time', async () => {
  await page.getByRole('radio', { name: 'Claude Code CLI' }).click();
  await expect(page.getByText('Detected on PATH.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('sonnet');

  await choose('Model', 'opus');
  await expect(page.getByText('Saved. Using opus · low.')).toBeVisible();
  await choose('Effort', 'high');
  await expect(page.getByText('Saved. Using opus · high.')).toBeVisible();
  await expect
    .poll(() => settingsFile())
    .toMatchObject({
      selectedSummaryProvider: 'ClaudeCode',
      selectedClaudeModelId: 'opus',
      selectedClaudeEffort: 'high',
    });
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText('Detected on PATH.')).toBeVisible();

  await page.getByRole('radio', { name: 'Codex CLI' }).click();
  await expect(page.getByText('Not found on PATH', { exact: false })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('gpt-5.6');
});

test('Grok is not offered as a provider', async () => {
  await expect(page.getByRole('radio', { name: 'Local (on this device)' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Grok/ })).toHaveCount(0);
  await expect(
    page
      .getByRole('radiogroup', { name: 'Choose where summaries are generated' })
      .getByRole('radio'),
  ).toHaveCount(3);
});

test('meeting language and summary language are saved on their own', async () => {
  await choose('Transcription language', 'Portuguese');
  await choose('Summary language', 'English');
  await expect
    .poll(() => settingsFile())
    .toMatchObject({ transcriptionLanguage: 'pt', summaryLanguage: 'en' });
  expect(await page.evaluate(() => window.vozella.invoke('settings.getPage', {}))).toMatchObject({
    transcriptionLanguage: 'pt',
    summaryLanguage: 'en',
  });
});

test('the app language switches at once, saves, and offers a restart that Later declines', async () => {
  await choose('App language', 'Español');
  // The screens switch before the prompt opens, so the prompt is already in the new language.
  const dialog = page.getByRole('dialog', { name: 'Reinicio necesario' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reiniciar ahora' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Más tarde' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 2, name: 'Proveedor de resumen' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Idioma de la aplicación' })).toContainText(
    'Español',
  );
  await expect.poll(() => settingsFile().uiLanguage).toBe('es');

  // Back to English so the later tests read the same words.
  await choose('Idioma de la aplicación', 'English');
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

for (const theme of ['light', 'dark'] as const) {
  test(`the settings page has no serious accessibility violations in ${theme}`, async () => {
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Summary provider' })).toBeVisible();
    await page.getByRole('radio', { name: 'Local (on this device)' }).click();
    await expect(page.getByRole('radiogroup', { name: 'Summary models' })).toBeVisible();
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const axe = (
        window as unknown as {
          axe: { run: () => Promise<{ violations: { id: string; impact: string | null }[] }> };
        }
      ).axe;
      const result = await axe.run();
      return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    });
    expect(violations).toEqual([]);
  });
}
