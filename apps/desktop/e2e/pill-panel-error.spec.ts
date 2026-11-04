import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installEngine, launchApp, readyEnv } from './launch';

// The error path of the pill chat panel: a provider that fails (the fake summary provider, no real
// CLI and no real account) shows "Could not answer" inside the panel and the take goes on. Its own
// file because the app allows one instance. Fake native build. Windows only.
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/live-copilot.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/live-copilot');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

test.describe.configure({ timeout: 120_000, retries: 1 });

const seedClaude = (root: string): void => {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', 'settings.json'),
    JSON.stringify({ selectedSummaryProvider: 'ClaudeCode', selectedSummaryModelId: MODEL }),
  );
};

test('a failing provider shows Could not answer in the panel and the take goes on', async () => {
  const launched = await launchApp(
    { ...readyEnv, VOZELLA_E2E_SHOW: '1', VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' },
    seedClaude,
  );
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.getByRole('link', { name: 'Record' }).click();
    await installEngine(page);
    const start = await page.evaluate(() =>
      window.vozella.invoke('recording.start', {
        title: 'Panel error',
        folderId: null,
        microphone: null,
        appName: null,
      }),
    );
    expect(start).toMatchObject({ started: true });
    await expect
      .poll(() => launched.app.windows().some((p) => p.url().endsWith('/pill.html')), {
        timeout: 15_000,
      })
      .toBe(true);
    const pill = launched.app.windows().find((p) => p.url().endsWith('/pill.html'));
    if (!pill) throw new Error('no pill page');
    await expect(pill.getByRole('status')).toHaveCount(0, { timeout: 10_000 });
    // A click while the entrance fade or a window move still runs can be lost: try again.
    await expect(async () => {
      await pill.locator('#BtnLiveCopilotChat').click({ timeout: 2_000 });
      await expect(pill.getByTestId('LiveCopilotPanel')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await pill.getByTestId('BtnLiveCopilotChipExplain').click();
    const error = pill.getByTestId('InfoLiveCopilotError');
    await expect(error).toContainText('Could not answer', { timeout: 30_000 });
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(pill.getByTestId('TxtLiveCopilotEmpty')).toHaveCount(0);
    await expect(pill.getByRole('progressbar', { name: 'Answering' })).toHaveCount(0);
    // The take goes on: the stop button is still there and works.
    await expect(pill.locator('#BtnLiveCopilotStop')).toBeEnabled();
    await expect(pill.getByRole('status')).toHaveCount(0, { timeout: 10_000 });
    if (shots) {
      fs.mkdirSync(outDir, { recursive: true });
      await pill.screenshot({ path: path.join(outDir, 'panel-error-dark.png') });
    }
    await page
      .evaluate(() => window.vozella.invoke('recording.discard', {}))
      .catch(() => undefined);
  } finally {
    await launched.app
      .evaluate(({ app }) => {
        app.exit(0);
      })
      .catch(() => undefined);
    await launched.close().catch(() => undefined);
  }
});
