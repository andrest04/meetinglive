import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  installEngine,
  launchApp,
  packagedShot,
  readyEnv,
  restoreMain,
  seedReadySettings,
} from './launch';

// The main flow in the packaged e2e build (pnpm package:e2e, then pnpm test:e2e:packaged): the
// window opens, a take is recorded from the fake microphone (a tone), stopped, and the saved
// summary appears. The fake native build and the fake summary provider are used, so no device,
// model or account is touched. The take from a generated WAV with the real addon is
// recording-real.spec.ts. This spec only runs against a packaged executable.

test.skip(
  !process.env.VOZELLA_E2E_EXECUTABLE,
  'set VOZELLA_E2E_EXECUTABLE to a packaged e2e build',
);
test.describe.configure({ timeout: 150_000 });

function markdowns(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdowns(full);
    return entry.name.endsWith('.md') ? [fs.readFileSync(full, 'utf8')] : [];
  });
}

test('the packaged window opens and a take goes from Record to a saved summary', async () => {
  const launched = await launchApp(
    {
      ...readyEnv,
      VOZELLA_E2E_SHOW: process.env.VOZELLA_PACKAGED_SHOTS === '1' ? '1' : '0',
      VOZELLA_FAKE_SUMMARY_DELAY_MS: '1500',
    },
    seedReadySettings,
  );
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page).toHaveTitle(/Vozella/);
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 820);
    });

    await page.getByRole('link', { name: /Record|Grabar/ }).click();
    await installEngine(page);
    await page.getByRole('link', { name: /Record|Grabar/ }).click();
    await expect(page.getByTestId('BtnRecord')).toBeEnabled({ timeout: 30_000 });
    await packagedShot(page, 'record-idle.png');

    await page.getByRole('textbox', { name: 'Title' }).fill('Packaged check');
    await page.getByTestId('BtnRecord').click();
    await expect(page.getByTestId('recording-bar')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('canvas-lines').locator('li').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(800);
    // Starting a take minimizes the main window (the live copilot pill takes over), and a
    // minimized window paints nothing. Bring it back the way the pill's Show button does.
    await restoreMain(launched.app);
    await packagedShot(page, 'record-recording.png');

    await page.getByRole('button', { name: 'Stop' }).click();
    const card = page.getByTestId('result-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('status-text')).not.toContainText('Generating', {
      timeout: 60_000,
    });
    await expect(card).toContainText('Packaged check');
    await packagedShot(page, 'record-result.png');

    await expect
      .poll(() => markdowns(launched.dataRoot).some((t) => t.includes('Packaged check')), {
        timeout: 30_000,
      })
      .toBe(true);
    const md = markdowns(launched.dataRoot).find((t) => t.includes('Packaged check')) ?? '';
    expect(md).toContain('The team went over the plan');

    await card.getByTestId('BtnOpenResult').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Packaged check', {
      timeout: 15_000,
    });
    await packagedShot(page, 'session.png');

    await page.getByRole('link', { name: /Library|Biblioteca/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await packagedShot(page, 'library.png');

    await page.getByRole('link', { name: /Settings|Ajustes|Configuración/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await packagedShot(page, 'settings.png');
  } finally {
    await launched.close();
  }
});
