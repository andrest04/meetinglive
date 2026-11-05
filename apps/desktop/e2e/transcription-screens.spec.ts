import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './launch';

// Regenerates docs/port/screens/transcription/*.png. Opt in with VOZELLA_SCREENSHOTS=1.
test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');

const outDir = path.resolve(__dirname, '../../../docs/port/screens/transcription');
const MEETING_ID = '0c6d1b8a-33a4-4f6e-9f7e-5a1d2c3b4e55';

function silentWav(seconds: number): Buffer {
  const data = Buffer.alloc(16_000 * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function launchShown(env: Record<string, string>, seed?: (root: string) => void) {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1', ...env }, seed);
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 980);
  });
  await page.waitForTimeout(300);
  return { launched, page };
}

async function open(page: Page, hash: string, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await page.evaluate((value) => {
    window.location.hash = value;
  }, hash);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

for (const theme of ['light', 'dark'] as const) {
  test(`record gate and live transcript in ${theme}`, async () => {
    const { launched, page } = await launchShown({ VOZELLA_FAKE_ENGINE_STEP_MS: '1500' });
    try {
      await open(page, '#/record', theme);
      await page.getByRole('textbox', { name: 'Title' }).fill('Weekly planning');
      await page.getByRole('button', { name: 'Record', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Download transcription engine' });
      await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^[1-9]/);
      await shot(page, `engine-setup-${theme}`);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByText('Setup cancelled.')).toBeVisible();
      await shot(page, `engine-setup-cancelled-${theme}`);

      await page.getByRole('button', { name: 'Record', exact: true }).click();
      await expect(page.getByTestId('recording-status')).toContainText('Recording...', {
        timeout: 60_000,
      });
      const pane = page.getByRole('region', { name: 'Live transcript' });
      await expect(pane).toContainText('Hoy revisamos', { timeout: 30_000 });
      await shot(page, `live-transcript-${theme}`);
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect(page.getByTestId('recording-status')).toBeHidden();

      await open(page, '#/settings', theme);
      await expect(page.getByTestId('transcription-section')).toBeVisible();
      await expect(page.getByTestId('live-drops-caption')).toBeVisible();
      await page.getByTestId('transcription-section').scrollIntoViewIfNeeded();
      await launched.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 1500);
      });
      await page.waitForTimeout(400);
      await shot(page, `settings-transcription-${theme}`);
    } finally {
      await launched.close();
    }
  });

  test(`engine setup failure in ${theme}`, async () => {
    const { launched, page } = await launchShown({
      VOZELLA_FAKE_ENGINE_FAIL: 'getaddrinfo ENOTFOUND github.com',
    });
    try {
      await open(page, '#/record', theme);
      await page.getByRole('button', { name: 'Record', exact: true }).click();
      await expect(page.getByText('getaddrinfo ENOTFOUND github.com')).toBeVisible();
      await shot(page, `engine-setup-failed-${theme}`);
    } finally {
      await launched.close();
    }
  });

  test(`settings with nothing installed in ${theme}`, async () => {
    const { launched, page } = await launchShown({ VOZELLA_FAKE_ENGINE_STEP_MS: '1500' });
    try {
      await open(page, '#/settings', theme);
      const section = page.getByTestId('transcription-section');
      await expect(section).toBeVisible();
      await section
        .getByRole('button', { name: 'Download Nemotron 3.5 ASR Streaming 0.6B' })
        .click();
      await expect(section.getByRole('progressbar').first()).toHaveAttribute(
        'aria-valuenow',
        /^[1-9]/,
      );
      await launched.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 1500);
      });
      await page.waitForTimeout(400);
      await shot(page, `settings-engine-downloading-${theme}`);
    } finally {
      await launched.close();
    }
  });

  test(`re-transcription in ${theme}`, async () => {
    const { launched, page } = await launchShown({ VOZELLA_FAKE_ENGINE_INSTALLED: '1' }, (root) => {
      const inbox = path.join(root, 'meetings', 'Inbox');
      fs.mkdirSync(inbox, { recursive: true });
      const wav = path.join(inbox, 'Weekly sync.wav');
      fs.writeFileSync(wav, silentWav(7));
      fs.writeFileSync(
        path.join(inbox, '2026-11-02 Weekly sync.md'),
        [
          '---',
          `id: ${MEETING_ID}`,
          'title: Weekly sync',
          'recordedAt: 2026-11-02T14:05:00.0000000+00:00',
          `audioFilePath: ${wav}`,
          '---',
          '',
          '## Transcript',
          '',
          '[00:00.00-00:01.00] texto viejo',
          '',
        ].join('\n'),
        'utf8',
      );
    });
    try {
      await open(page, '#/library', theme);
      await page
        .getByRole('grid', { name: 'Library' })
        .getByRole('row', { name: /Weekly sync/ })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: 'Weekly sync' })).toBeVisible();
      await shot(page, `session-retranscribe-${theme}`);
      await page.getByRole('button', { name: 'Re-transcribe', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Re-transcribe this meeting?' })).toBeVisible();
      await shot(page, `session-retranscribe-confirm-${theme}`);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Re-transcribe', exact: true })
        .click();
      await expect(page.getByText(/Re-transcribed\./)).toBeVisible({ timeout: 30_000 });
      await shot(page, `session-retranscribe-done-${theme}`);
    } finally {
      await launched.close();
    }
  });
}
