import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp, NO_GALLERY, packaged } from './launch';

// The summary setup wizard in the real app with the fake native build: the fake hardware probe,
// the scripted fake model folder (no network, no file) and a settings file on disk that is the
// truth. The wizard opens from the component gallery, which is the dev entry for the chooser.
// Screenshots (docs/port/screens/summaries) are rewritten only with VOZELLA_SCREENSHOTS=1.

test.skip(packaged, NO_GALLERY);
test.describe.configure({ timeout: 150_000 });

const SMALL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

interface Session {
  readonly launched: LaunchedApp;
  readonly page: Page;
  readonly settings: () => Record<string, unknown>;
}

async function start(env: Record<string, string> = {}): Promise<Session> {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1', ...env });
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 780);
  });
  await page.evaluate(() => {
    window.location.hash = '#/gallery';
  });
  await expect(page.getByTestId('gallery')).toBeVisible();
  return {
    launched,
    page,
    settings: () => {
      const file = path.join(launched.dataRoot, 'app', 'settings.json');
      return fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)
        : {};
    },
  };
}

const openWizard = async (page: Page, name: 'Open the wizard' | 'Open on the model step') => {
  await page.getByRole('button', { name }).click();
  await expect(page.getByRole('dialog', { name: 'Set up summary generation' })).toBeVisible();
};

const serious = async (page: Page) => {
  await page.evaluate(axe.source);
  const results = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(document),
  );
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }));
};

test.describe('with a GPU and a slow download', () => {
  let session: Session;
  test.beforeAll(async () => {
    session = await start({ VOZELLA_FAKE_MODEL_STEP_MS: '500' });
  });
  test.afterAll(async () => {
    await session.launched.close();
  });

  test('the chooser lists Claude Code, Codex and Local models, and no Grok', async () => {
    const { page } = session;
    await openWizard(page, 'Open the wizard');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Choose how to generate summaries')).toBeVisible();
    const ids = await dialog
      .locator('[data-testid^="BtnEngine"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
    expect(ids).toEqual(['BtnEngineClaudeCode', 'BtnEngineCodex', 'BtnEngineLocal']);
    await expect(
      dialog.getByText('Uses the Codex CLI already installed on this PC.'),
    ).toBeVisible();
    await expect(dialog.getByText(/Grok/)).toHaveCount(0);
    expect(await serious(page)).toEqual([]);
  });

  test('a CLI choice leaves the chooser and Back returns to it', async () => {
    const { page } = session;
    await page.getByTestId('BtnEngineCodex').click();
    await expect(page.getByTestId('BtnEngineLocal')).toHaveCount(0);
    await page.getByTestId('BtnBackToEngineChoice').click();
    await expect(page.getByTestId('BtnEngineLocal')).toBeVisible();
  });

  test('Local models shows the hardware line, the rows and their fit', async () => {
    const { page } = session;
    await page.getByTestId('BtnEngineLocal').click();
    await expect(page.getByText('Choose a model to generate summaries')).toBeVisible();
    await expect(page.getByTestId('TxtHardware')).toHaveText(
      'Detected: 16 GB RAM, GPU Fake GPU (8 GB VRAM)',
    );
    const list = page.getByTestId('ListModelOptions');
    await expect(list.getByRole('radio')).toHaveCount(4);
    await expect(list.getByText('Llama 3.2 1B Instruct')).toBeVisible();
    await expect(list.getByText(/0\.8 GB download/)).toBeVisible();
    await expect(list.getByText('Recommended').first()).toBeVisible();
    await expect(list.getByRole('radio').first()).toBeChecked();
    expect(await serious(page)).toEqual([]);
  });

  test('Cancel download returns to the list and saves nothing (B6)', async () => {
    const { page, settings } = session;
    await page.getByTestId('BtnDownloadModel').click();
    const status = page.getByTestId('TxtDownloadStatus');
    await expect(status).toContainText('Downloading Llama 3.2 1B Instruct (');
    await expect(page.getByRole('progressbar')).toBeVisible();
    await expect(status).toContainText('(10%)');
    expect(await serious(page)).toEqual([]);
    await page.getByTestId('BtnCancelDownload').click();
    await expect(page.getByText('Choose a model to generate summaries')).toBeVisible();
    await expect(page.getByTestId('TxtModelError')).toHaveCount(0);
    // Give a late answer time to arrive; nothing may be saved or finish the wizard.
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(settings().selectedSummaryModelId ?? null).toBeNull();
    const rows = await page.evaluate(() => window.vozella.invoke('summaries.hardware', {}));
    expect(rows.rows.some((row) => row.downloaded)).toBe(false);
  });

  test('closing the dialog during a download cancels it and saves nothing', async () => {
    const { page, settings } = session;
    await page.getByTestId('BtnDownloadModel').click();
    await expect(page.getByTestId('PanelDownloading')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.waitForTimeout(3500);
    expect(settings().selectedSummaryModelId ?? null).toBeNull();
    const rows = await page.evaluate(() => window.vozella.invoke('summaries.hardware', {}));
    expect(rows.rows.some((row) => row.downloaded)).toBe(false);
  });

  test('a finished download saves the model and Local, and closes the wizard', async () => {
    const { page, settings } = session;
    await openWizard(page, 'Open on the model step');
    await expect(page.getByText('Choose a model to generate summaries')).toBeVisible();
    await page.getByTestId('BtnDownloadModel').click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    expect(settings()).toMatchObject({
      selectedSummaryModelId: SMALL,
      selectedSummaryProvider: 'Local',
    });
  });

  test('the chooser opens on the model step in Spanish with the Spanish copy', async () => {
    const { page } = session;
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
    await page.getByRole('button', { name: 'Open on the model step' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Elige un modelo para generar resúmenes')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'en-US' }));
  });
});

test.describe('without a GPU and with a model on disk', () => {
  let session: Session;
  test.beforeAll(async () => {
    session = await start({ VOZELLA_FAKE_NO_GPU: '1', VOZELLA_FAKE_MODEL_PRESENT: SMALL });
  });
  test.afterAll(async () => {
    await session.launched.close();
  });

  test('local-only mode opens on the model step, no chooser, with the no-GPU line', async () => {
    const { page } = session;
    await openWizard(page, 'Open on the model step');
    await expect(page.getByText('Choose a model to generate summaries')).toBeVisible();
    await expect(page.getByTestId('BtnEngineLocal')).toHaveCount(0);
    await expect(page.getByTestId('TxtHardware')).toHaveText(
      'Detected: 16 GB RAM, no dedicated GPU',
    );
    // The downloaded model is marked and is the default selection.
    const row = page.getByRole('radio', { name: /Llama 3\.2 1B Instruct \(downloaded\)/ });
    await expect(row).toBeChecked();
    expect(await serious(page)).toEqual([]);
  });

  test('choosing the downloaded model finishes at once without a download panel', async () => {
    const { page, settings } = session;
    await page.getByTestId('BtnDownloadModel').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(settings()).toMatchObject({
      selectedSummaryModelId: SMALL,
      selectedSummaryProvider: 'Local',
    });
  });
});

test.describe('a download that fails once', () => {
  let session: Session;
  test.beforeAll(async () => {
    session = await start({
      VOZELLA_FAKE_MODEL_STEP_MS: '60',
      VOZELLA_FAKE_MODEL_FAIL: 'The server closed the connection',
      VOZELLA_FAKE_MODEL_FAIL_COUNT: '1',
    });
  });
  test.afterAll(async () => {
    await session.launched.close();
  });

  test('shows the error on the list with Try again, and the retry completes (B7)', async () => {
    const { page, settings } = session;
    await openWizard(page, 'Open on the model step');
    await page.getByTestId('BtnDownloadModel').click();
    await expect(page.getByTestId('TxtModelError')).toHaveText(
      'Error downloading the model: The server closed the connection',
    );
    await expect(page.getByText('Choose a model to generate summaries')).toBeVisible();
    expect(settings().selectedSummaryModelId ?? null).toBeNull();
    expect(await serious(page)).toEqual([]);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    expect(settings()).toMatchObject({ selectedSummaryProvider: 'Local' });
  });
});

test.describe('screenshots', () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  const outDir = path.resolve(__dirname, '../../../docs/port/screens/summaries');

  for (const theme of ['light', 'dark'] as const) {
    test(`wizard in ${theme}`, async () => {
      const session = await start({
        VOZELLA_FAKE_MODEL_STEP_MS: '1500',
        VOZELLA_FAKE_MODEL_FAIL: 'The server closed the connection',
        VOZELLA_FAKE_MODEL_FAIL_COUNT: '1',
      });
      try {
        const { page } = session;
        await page.evaluate((value) => {
          window.localStorage.setItem('vozella.theme', value);
        }, theme);
        await page.reload();
        await page.evaluate(() => {
          window.location.hash = '#/gallery';
        });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByTestId('gallery')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        fs.mkdirSync(outDir, { recursive: true });
        const shot = async (name: string): Promise<void> => {
          await page.waitForTimeout(350);
          await page.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) });
        };

        await openWizard(page, 'Open the wizard');
        await shot('wizard-engine');
        await page.getByTestId('BtnEngineLocal').click();
        await expect(page.getByTestId('TxtHardware')).toBeVisible();
        await shot('wizard-models');
        await page.getByTestId('BtnDownloadModel').click();
        await expect(page.getByTestId('TxtDownloadStatus')).toContainText('(25%)');
        await shot('wizard-downloading');
        await expect(page.getByTestId('TxtModelError')).toBeVisible({ timeout: 20_000 });
        await shot('wizard-failed');
      } finally {
        await session.launched.close();
      }
    });
  }

  test('wizard in Spanish', async () => {
    const session = await start({ VOZELLA_FAKE_NO_GPU: '1' });
    try {
      const { page } = session;
      await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
      await page.getByRole('button', { name: 'Open the wizard' }).click();
      await expect(page.getByTestId('BtnEngineLocal')).toBeVisible();
      fs.mkdirSync(outDir, { recursive: true });
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(outDir, 'wizard-engine-es.png') });
      await page.getByTestId('BtnEngineLocal').click();
      await expect(page.getByTestId('TxtHardware')).toBeVisible();
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(outDir, 'wizard-models-es.png') });
    } finally {
      await session.launched.close();
    }
  });
});
