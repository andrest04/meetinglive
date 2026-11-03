import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_APPS } from './fake-audio-apps';
import { installEngine, launchApp, readyEnv, seedReadySettings, type LaunchedApp } from './launch';

// The Record page's take in the real window on the fake native build: the fake microphone plays a
// tone, so a recording writes a real WAV into the Inbox of a throwaway data root. The file picker
// is replaced in the main process, so no dialog opens and no real file is read.

let launched: LaunchedApp;
let page: Page;

function wavFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return wavFiles(full);
    return entry.name.endsWith('.wav') ? [full] : [];
  });
}

/** Walks the RIFF chunks to the data chunk: its declared size and the bytes that follow it. */
function dataChunk(bytes: Buffer): { declared: number; length: number } {
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.subarray(at, at + 4).toString('ascii');
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'data') return { declared: size, length: bytes.length - (at + 8) };
    at += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  launched = await launchApp(
    { VOZELLA_FAKE_AUDIO_APPS: FAKE_APPS, ...readyEnv },
    seedReadySettings,
  );
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await installEngine(page);
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Sources' })).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

test('app cards show the icon of the executable', async () => {
  const zoom = page.getByRole('radio', { name: /Zoom Workplace/ });
  await expect(zoom).toBeVisible();
  await expect(
    page
      .getByRole('radiogroup', { name: 'Meeting audio' })
      .locator('img[src^="data:image/png"]')
      .first(),
  ).toBeVisible();
});

test('record, pause, resume and stop leave a readable WAV in the Inbox', async () => {
  await page.getByRole('textbox', { name: 'Title' }).fill('E2E take');
  await page.getByRole('button', { name: 'Record' }).click();

  const status = page.getByTestId('recording-status');
  await expect(status).toContainText('Recording... mic + system audio.');
  await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
  // The tone from the fake microphone moves the level bar.
  await expect
    .poll(async () =>
      Number(
        await page.getByRole('meter', { name: 'Microphone level' }).getAttribute('aria-valuenow'),
      ),
    )
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(status).toContainText('Paused. The break is not recorded.');
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(status).toContainText('Recording... mic + system audio.');
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByTestId('result-card')).toContainText('E2E take', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Record' })).toBeEnabled();

  const files = wavFiles(launched.dataRoot).filter((file) => file.includes('E2E take'));
  expect(files).toHaveLength(1);
  const bytes = fs.readFileSync(files[0] ?? '');
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(44);
  // The header was finished by Stop: the data chunk length matches what follows it.
  const data = dataChunk(bytes);
  expect(data.length).toBeGreaterThan(0);
  expect(data.declared).toBe(data.length);
  expect(path.basename(path.dirname(files[0] ?? ''))).toBe('Inbox');
});

test('import audio converts a picked file into the Inbox', async () => {
  const source = wavFiles(launched.dataRoot).find((file) => file.includes('E2E take'));
  expect(source).toBeTruthy();
  await launched.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, source ?? '');

  await page.getByRole('textbox', { name: 'Title' }).fill('E2E import');
  await page.getByRole('button', { name: 'Import audio' }).click();
  await expect(page.getByTestId('result-card')).toContainText('E2E import', { timeout: 60_000 });

  const imported = wavFiles(launched.dataRoot).filter((file) => file.includes('E2E import'));
  expect(imported).toHaveLength(1);
  const bytes = fs.readFileSync(imported[0] ?? '');
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(bytes.length).toBeGreaterThan(44);
});

test('a cancelled picker changes nothing', async () => {
  await launched.app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
  });
  const before = wavFiles(launched.dataRoot).length;
  await page.getByRole('button', { name: 'Import audio' }).click();
  await expect(page.getByRole('button', { name: 'Import audio' })).toBeEnabled();
  expect(wavFiles(launched.dataRoot)).toHaveLength(before);
});
