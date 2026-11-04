import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// The Record screen in the real window on the fake native build: the setup gate, the destination,
// a take from Record to the result card, and the removed provider message. Screenshots
// (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/recording.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/recording');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

let launched: LaunchedApp;
let page: Page;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const seedSettings = (settings: Record<string, unknown>) => (root: string) => {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'settings.json'), JSON.stringify(settings));
};

async function setTheme(theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

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
    {
      VOZELLA_E2E_SHOW: shots ? '1' : '0',
      VOZELLA_FAKE_ENGINE_STEP_MS: '5',
      VOZELLA_FAKE_MODEL_PRESENT: MODEL,
    },
    seedSettings({ selectedSummaryProvider: 'Local', selectedSummaryModelId: MODEL }),
  );
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 900);
  });
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Record meeting' })).toBeVisible();
});

test.afterAll(async () => {
  await page.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
});

test('without the engine the checklist replaces the Record button', async () => {
  const panel = page.getByTestId('setup-checklist');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('setup-card')).toHaveCount(3);
  await expect(panel.getByTestId('setup-card').nth(1)).toContainText('Needs setup');
  await expect(panel.getByTestId('setup-card').nth(2)).toContainText('Ready');
  await expect(page.getByText('Set up recording before you start.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import audio' })).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await expect(panel).toBeVisible();
    expect(await serious()).toEqual([]);
    await shot(`screen-setup-${theme}.png`);
  }
});

test('Set up to record asks, installs the engine and shows Record', async () => {
  await page.getByRole('button', { name: 'Set up to record' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set up recording' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('setup-card')).toHaveCount(3);
  await shot('screen-setup-dialog-dark.png');
  await dialog.getByRole('button', { name: 'Set up', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
  await expect(page.getByText('Ready to record.')).toHaveCount(0);
});

test('the destination lists the Inbox first, then the folders as paths', async () => {
  await page.evaluate(async () => {
    const parent = await window.vozella.invoke('library.createFolder', {
      name: 'Clients',
      parentId: null,
    });
    if (parent.ok) {
      await window.vozella.invoke('library.createFolder', {
        name: 'Acme',
        parentId: parent.folder.id,
      });
    }
    await window.vozella.invoke('library.createFolder', { name: 'archive', parentId: null });
  });
  // The list reloads on every entry to the page.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('link', { name: 'Record' }).click();
  const combo = page.getByRole('combobox', { name: 'Save to' });
  await expect(combo).toContainText('Inbox');
  await combo.click();
  const options = page.getByRole('option');
  await expect(options).toHaveText(['Inbox', 'archive', 'Clients', 'Clients / Acme']);
  await page.getByRole('option', { name: 'Clients / Acme' }).click();
  await expect(combo).toContainText('Clients / Acme');
  // The choice survives leaving the page.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('combobox', { name: 'Save to' })).toContainText('Clients / Acme');
});

test('the default title follows the pattern and the idle page has no serious violations', async () => {
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    /^Meeting \d{1,2} \w{3}, \d{2}:\d{2}$/,
  );
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible();
    expect(await serious()).toEqual([]);
    await shot(`screen-idle-${theme}.png`);
  }
});

test('a take runs from Record to the result card, and Open shows the meeting', async () => {
  await page.getByRole('textbox', { name: 'Title' }).fill('Screen check');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bar-title')).toHaveText('Screen check');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Save to' })).toHaveCount(0);
  await expect(page.getByTestId('recording-status')).toContainText('Recording');
  await page.waitForTimeout(800);
  await shot('screen-recording-dark.png');
  await stop.click();
  const card = page.getByTestId('result-card');
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText('Screen check');
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(/^Meeting /);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await expect(card).toBeVisible();
    expect(await serious()).toEqual([]);
    await shot(`screen-result-${theme}.png`);
  }
  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/#\/session|\/session/);
});

test('a settings file that selects the removed provider asks for another one', async () => {
  const second = await launchApp(
    { VOZELLA_FAKE_ENGINE_STEP_MS: '5' },
    seedSettings({ selectedSummaryProvider: 'Xai' }),
  );
  try {
    const other = await second.app.firstWindow();
    await other.getByRole('link', { name: 'Record' }).click();
    await expect(other.getByTestId('TxtProviderUnavailable')).toContainText(
      'Grok (xAI) is no longer available',
    );
    await expect(other.getByTestId('setup-card').nth(2)).toContainText('Needs setup');
    await expect(other.getByTestId('setup-card').nth(2)).toContainText('Not chosen');
  } finally {
    await second.close();
  }
});
