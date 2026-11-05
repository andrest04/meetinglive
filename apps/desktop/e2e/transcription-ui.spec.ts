import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// The transcription pages in the real window on the fake native build: the engine downloads are
// stepped and can be made to fail, the speech engine "hears" a fixed script, and the data root is a
// throwaway folder. No network, no model, no account.

const MEETING_ID = '0c6d1b8a-33a4-4f6e-9f7e-5a1d2c3b4e55';

/** A 16 kHz mono PCM16 WAV of silence; the fake engine answers by duration, not by sound. */
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

const settingsFile = (app: LaunchedApp): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(app.dataRoot, 'app', 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;

async function start(env: Record<string, string>, seed?: (root: string) => void) {
  const launched = await launchApp(env, seed);
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  return { launched, page };
}

const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

/** The summary is ready, so only the engine is missing: the record gate is the engine step. */
const summaryReady = { VOZELLA_FAKE_MODEL_PRESENT: MODEL };
const seedLocal = (root: string): void => {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', 'settings.json'),
    JSON.stringify({ selectedSummaryProvider: 'Local', selectedSummaryModelId: MODEL }),
  );
};

/** Set up to record, then Set up in the checklist: the engine dialog opens (spec 2.4). */
async function openEngineSetup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Set up to record' }).click();
  const checklist = page.getByRole('dialog', { name: 'Set up recording' });
  await checklist.getByRole('button', { name: 'Set up', exact: true }).click();
}

async function go(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name }).click();
}

test.describe('the engine gate on Record', () => {
  let launched: LaunchedApp;
  let page: Page;

  test.beforeAll(async () => {
    ({ launched, page } = await start(
      { VOZELLA_FAKE_ENGINE_STEP_MS: '600', ...summaryReady },
      seedLocal,
    ));
    await go(page, 'Record');
    await expect(page.getByRole('heading', { level: 2, name: 'Sources' })).toBeVisible();
  });
  test.afterAll(async () => {
    await launched.close();
  });
  test.describe.configure({ mode: 'serial' });

  test('Set up opens the download dialog with progress, and Cancel leaves no recording', async () => {
    await openEngineSetup(page);
    const dialog = page.getByRole('dialog', { name: 'Download transcription engine' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('engine-setup-status')).toContainText(/Downloading the/);
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    // A cancelled step ends the pass and the checklist asks again; Cancel there ends the loop.
    const checklist = page.getByRole('dialog', { name: 'Set up recording' });
    await checklist.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Setup cancelled.')).toBeVisible();
    await expect(page.getByTestId('recording-status')).toBeHidden();
    const status = await page.evaluate(() => window.vozella.invoke('transcription.getStatus', {}));
    expect(status.ready).toBe(false);
  });

  test('after the download the take starts and the live transcript fills in', async () => {
    test.setTimeout(90_000);
    await openEngineSetup(page);
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByTestId('recording-status')).toContainText('Recording...');
    const pane = page.getByRole('region', { name: 'Live transcript' });
    await expect(pane).toBeVisible();
    await expect(pane).toContainText('Buenos días a todos', { timeout: 30_000 });
    await expect(pane.getByText('Recorded 20')).toBeVisible();
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('recording-status')).toBeHidden();
    await expect(pane).toBeHidden();
  });
});

test('a failed download shows the raw message and Try again, and cancel records nothing', async () => {
  const { launched, page } = await start(
    { VOZELLA_FAKE_ENGINE_FAIL: 'getaddrinfo ENOTFOUND github.com', ...summaryReady },
    seedLocal,
  );
  try {
    await go(page, 'Record');
    await openEngineSetup(page);
    const dialog = page.getByRole('dialog', { name: 'Download transcription engine' });
    await expect(dialog.getByText('Download failed', { exact: true })).toBeVisible();
    await expect(dialog.getByText('getaddrinfo ENOTFOUND github.com')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page
      .getByRole('dialog', { name: 'Set up recording' })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(page.getByTestId('recording-status')).toBeHidden();
  } finally {
    await launched.close();
  }
});

test('Settings: engine, live preview and speaker labels', async () => {
  const { launched, page } = await start({ VOZELLA_FAKE_ENGINE_STEP_MS: '120' });
  try {
    await go(page, 'Settings');
    const section = page.getByTestId('transcription-section');
    await expect(section).toBeVisible();
    await expect(section.getByText('Not installed').first()).toBeVisible();

    const download = section.getByRole('button', {
      name: 'Download Nemotron 3.5 ASR Streaming 0.6B',
    });
    await download.click();
    await expect(section.getByTestId('engine-progress')).toBeVisible();
    await expect(section.getByText('Installed').first()).toBeVisible({ timeout: 30_000 });
    await expect(download).toBeDisabled();
    await expect(section.getByTestId('acceleration-caption')).toContainText('Will use CPU');

    const live = section.getByRole('switch', { name: 'Live transcription during recording' });
    await expect(live).toBeChecked();
    await live.click();
    await expect(live).not.toBeChecked();
    await expect.poll(() => settingsFile(launched).liveTranscriptionEnabled).toBe(false);

    const labels = section.getByRole('switch', { name: 'Speaker labels' });
    await expect(labels).not.toBeChecked();
    await labels.click();
    await expect(labels).toBeChecked({ timeout: 30_000 });
    await expect.poll(() => settingsFile(launched).speakerDiarizationEnabled).toBe(true);
    await expect(section.getByRole('button', { name: 'Delete Speaker model' })).toBeEnabled();

    await section.getByRole('button', { name: 'Delete Speaker model' }).click();
    await expect(labels).not.toBeChecked();
    await expect(section.getByRole('button', { name: 'Download Speaker model' })).toBeEnabled();

    await section.getByRole('button', { name: 'Delete Nemotron 3.5 ASR Streaming 0.6B' }).click();
    await expect(section.getByText('Not installed').first()).toBeVisible();
  } finally {
    await launched.close();
  }
});

test('Session: re-transcribe a saved meeting after a confirmation', async () => {
  const { launched, page } = await start({ VOZELLA_FAKE_ENGINE_INSTALLED: '1' }, (root) => {
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
    await go(page, 'Library');
    await page
      .getByRole('grid', { name: 'Library' })
      .getByRole('row', { name: /Weekly sync/ })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Weekly sync' })).toBeVisible();

    await page.getByRole('button', { name: 'Re-transcribe', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Re-transcribe this meeting?' });
    await expect(dialog).toContainText('Re-transcribing "Weekly sync" replaces its transcript');
    // Cancel changes nothing.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    const file = path.join(launched.dataRoot, 'meetings', 'Inbox', '2026-11-02 Weekly sync.md');
    expect(fs.readFileSync(file, 'utf8')).toContain('texto viejo');

    await page.getByRole('button', { name: 'Re-transcribe', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Re-transcribe this meeting?' })
      .getByRole('button', { name: 'Re-transcribe', exact: true })
      .click();
    await expect(
      // With no summary model downloaded the gate is not satisfied and the run ends with the
      // transcript only (spec 113), so the session page shows the no-summary outcome.
      page.getByText('Re-transcribed. The transcript was updated, but no summary was generated.'),
    ).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Buenos días a todos');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('texto viejo');
  } finally {
    await launched.close();
  }
});

test('Session: a meeting without audio offers no Re-transcribe button', async () => {
  const { launched, page } = await start({ VOZELLA_FAKE_ENGINE_INSTALLED: '1' }, (root) => {
    const inbox = path.join(root, 'meetings', 'Inbox');
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(
      path.join(inbox, '2026-11-02 Imported.md'),
      [
        '---',
        'id: 7a0f6a1e-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
        'title: Imported',
        'recordedAt: 2026-11-02T14:05:00.0000000+00:00',
        'audioFilePath: ',
        '---',
        '',
      ].join('\n'),
      'utf8',
    );
  });
  try {
    await go(page, 'Library');
    await page
      .getByRole('grid', { name: 'Library' })
      .getByRole('row', { name: /Imported/ })
      .click();
    // No saved audio: the header does not offer Re-transcribe at all (item 89).
    await expect(page.getByRole('heading', { level: 1, name: 'Imported' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Re-transcribe', exact: true })).toHaveCount(0);
  } finally {
    await launched.close();
  }
});

async function seriousViolations(page: Page): Promise<{ id: string; impact: string | null }[]> {
  await page.evaluate(axe.source);
  return page.evaluate(async () => {
    const runner = (
      window as unknown as {
        axe: { run: () => Promise<{ violations: { id: string; impact: string | null }[] }> };
      }
    ).axe;
    const result = await runner.run();
    return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`the engine dialog and the live pane have no serious violations in ${theme}`, async () => {
    test.setTimeout(90_000);
    const { launched, page } = await start(
      { VOZELLA_FAKE_ENGINE_STEP_MS: '600', ...summaryReady },
      seedLocal,
    );
    try {
      await page.evaluate((value) => {
        window.localStorage.setItem('vozella.theme', value);
      }, theme);
      await page.reload();
      await go(page, 'Record');
      await openEngineSetup(page);
      const dialog = page.getByRole('dialog', { name: 'Download transcription engine' });
      await expect(dialog.getByRole('progressbar')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await page.getByRole('button', { name: 'Record', exact: true }).click();
      await expect(page.getByTestId('recording-status')).toContainText('Recording...', {
        timeout: 60_000,
      });
      await expect(page.getByRole('region', { name: 'Live transcript' })).toContainText(
        'Buenos días',
        { timeout: 30_000 },
      );
      expect(await seriousViolations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Stop' }).click();
      await expect(page.getByTestId('recording-status')).toBeHidden();
    } finally {
      await launched.close();
    }
  });

  test(`the failed dialog has no serious violations in ${theme}`, async () => {
    const { launched, page } = await start(
      { VOZELLA_FAKE_ENGINE_FAIL: 'offline', ...summaryReady },
      seedLocal,
    );
    try {
      await page.evaluate((value) => {
        window.localStorage.setItem('vozella.theme', value);
      }, theme);
      await page.reload();
      await go(page, 'Record');
      await openEngineSetup(page);
      await expect(page.getByRole('dialog').getByText('offline')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    } finally {
      await launched.close();
    }
  });
}
