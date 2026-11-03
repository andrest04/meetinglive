import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_APPS } from './fake-audio-apps';
import { installEngine, launchApp, readyEnv, type LaunchedApp } from './launch';

// R12: the whole pipeline from Record to the saved summary in the real window on the fake native
// build. The fake microphone plays a tone, the fake speech engine "hears" a fixed script and the
// fake summary provider answers with a fixed reply, so nothing real is read and no account is used.
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/recording.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/recording');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

test.describe.configure({ timeout: 150_000 });

type Settings = Record<string, unknown>;

const seed = (settings: Settings) => (root: string) => {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', 'settings.json'),
    JSON.stringify({
      selectedSummaryProvider: 'Local',
      selectedSummaryModelId: MODEL,
      ...settings,
    }),
  );
};

async function open(
  env: Record<string, string> = {},
  settings: Settings = {},
  engine = true,
): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp(
    { ...readyEnv, VOZELLA_E2E_SHOW: shots ? '1' : '0', ...env },
    seed(settings),
  );
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 900);
  });
  await page.getByRole('link', { name: /Record|Grabar/ }).click();
  if (engine) {
    await installEngine(page);
    await page.getByRole('link', { name: /Record|Grabar/ }).click();
    await expect(page.getByTestId('BtnRecord')).toBeEnabled({ timeout: 30_000 });
  }
  return { launched, page };
}

async function closeApp(launched: LaunchedApp, page: Page): Promise<void> {
  await page.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
}

function files(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full, ext);
    return entry.name.endsWith(ext) ? [full] : [];
  });
}

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, name) });
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function serious(page: Page): Promise<{ id: string; impact: string | null }[]> {
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

async function record(page: Page, title: string | null): Promise<void> {
  if (title !== null) await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByTestId('BtnRecord').click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 });
}

/** Every saved meeting Markdown in the data root (the settings folder holds none). */
function meetings(launched: LaunchedApp): string[] {
  return files(launched.dataRoot, '.md').map((f) => fs.readFileSync(f, 'utf8'));
}

/** The saved Markdown of the meeting a take produced, found by a text it must contain. */
async function savedMarkdown(launched: LaunchedApp, part: string): Promise<string> {
  await expect
    .poll(() => meetings(launched).some((text) => text.includes(part)), { timeout: 30_000 })
    .toBe(true);
  return meetings(launched).find((text) => text.includes(part)) ?? '';
}

test('a full take: sources, live text, notes, highlight, pause, stop, statuses and the saved meeting', async () => {
  const { launched, page } = await open({
    VOZELLA_FAKE_AUDIO_APPS: FAKE_APPS,
    VOZELLA_FAKE_ASR_OFFLINE_PUSH_MS: '60',
    VOZELLA_FAKE_SUMMARY_DELAY_MS: '2500',
  });
  try {
    await expect(page.getByRole('heading', { level: 2, name: 'Sources' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Zoom Workplace/ })).toBeVisible();
    await shot(page, 'pipeline-idle-light.png');

    await page.getByRole('textbox', { name: 'Title' }).fill('Quarter planning');
    await page.getByRole('radio', { name: /Zoom Workplace/ }).click();
    await page.getByTestId('BtnRecord').click();
    await expect(page.getByTestId('recording-bar')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('recording-status')).toContainText('Recording');
    await expect(page.getByTestId('bar-sources')).toContainText('Mic:');

    // Live text arrives, and a settled line never rewrites itself while later text streams in.
    const lines = page.getByTestId('canvas-lines').locator('li');
    await expect(lines.first()).toBeVisible({ timeout: 30_000 });
    const first = await lines.first().innerText();
    await expect(lines.nth(1)).toBeVisible({ timeout: 30_000 });
    expect(await lines.first().innerText()).toBe(first);

    const notes = page.getByRole('textbox', { name: 'Notes' });
    await notes.click();
    await page.keyboard.type('Remember the budget cap');
    await page.getByRole('button', { name: 'Highlight' }).click();
    await expect(page.getByTestId('highlight-feedback')).toHaveText(/^Highlighted \d{2}:\d{2}/);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('recording-status')).toContainText('Paused');
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByTestId('recording-status')).toContainText('Recording');
    await page.waitForTimeout(800);
    await shot(page, 'pipeline-recording-light.png');

    await page.getByRole('button', { name: 'Stop' }).click();
    const status = page.getByTestId('recording-status');
    await expect(status).toContainText(/Transcribing audio/, { timeout: 30_000 });
    await expect(page.getByTestId('status-text')).toContainText(/Generating summary/, {
      timeout: 60_000,
    });
    const card = page.getByTestId('result-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('status-text')).not.toContainText('Generating', {
      timeout: 60_000,
    });
    await expect(card).toContainText('Quarter planning');
    await expect(card.getByTestId('BtnOpenResult')).toBeVisible();
    expect(await serious(page)).toEqual([]);
    await shot(page, 'pipeline-result-light.png');
    await setTheme(page, 'dark');
    await shot(page, 'pipeline-idle-dark.png');

    const md = await savedMarkdown(launched, 'Quarter planning');
    expect(md).toMatch(/Recorded/);
    expect(md).toMatch(/Ended/);
    expect(md).toContain('Remember the budget cap');
    expect(md).toContain('The team went over the plan');
    expect(md).toContain('Send the notes to the team');
    expect(md).toContain('Buenos días a todos');
    expect(files(launched.dataRoot, '.wav')).toHaveLength(1);
  } finally {
    await closeApp(launched, page);
  }
});

test('the card Open button goes to the meeting', async () => {
  const { launched, page } = await open();
  try {
    await record(page, 'Open check');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop' }).click();
    const card = page.getByTestId('result-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('status-text')).not.toContainText('Generating', {
      timeout: 60_000,
    });
    await card.getByTestId('BtnOpenResult').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Open check', {
      timeout: 15_000,
    });
  } finally {
    await closeApp(launched, page);
  }
});

test('an English placeholder title is replaced by the generated one', async () => {
  const { launched, page } = await open();
  try {
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(/^Meeting /);
    await page.getByTestId('BtnRecord').click();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('result-card')).toContainText('Fake planning meeting', {
      timeout: 60_000,
    });
    const md = await savedMarkdown(launched, 'Fake planning meeting');
    expect(md).not.toMatch(/^# Meeting \d/m);
  } finally {
    await closeApp(launched, page);
  }
});

test('a Spanish placeholder title is replaced too', async () => {
  const { launched, page } = await open({}, { uiLanguage: 'es' });
  try {
    await expect(page.getByTestId('TxtMeetingTitle')).toHaveValue(/^Reunión /);
    await page.getByTestId('BtnRecord').click();
    await expect(page.getByTestId('BtnStop')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.getByTestId('BtnStop').click();
    await expect(page.getByTestId('result-card')).toContainText('Fake planning meeting', {
      timeout: 60_000,
    });
  } finally {
    await closeApp(launched, page);
  }
});

test('microphone None records system audio only', async () => {
  const { launched, page } = await open(
    { VOZELLA_FAKE_AUDIO_APPS: FAKE_APPS },
    { recordMicrophoneKind: 'None' },
  );
  try {
    await record(page, 'No mic');
    await expect(page.getByTestId('bar-sources')).toContainText('Mic: None');
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
  } finally {
    await closeApp(launched, page);
  }
});

test('discard deletes the WAV and leaves no meeting', async () => {
  const { launched, page } = await open();
  try {
    await record(page, 'Throwaway');
    await page.waitForTimeout(1200);
    expect(files(launched.dataRoot, '.wav').length).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Discard' }).click();
    await page.getByTestId('BtnConfirmDiscard').click();
    await expect(page.getByTestId('BtnRecord')).toBeEnabled({ timeout: 30_000 });
    await expect.poll(() => files(launched.dataRoot, '.wav').length).toBe(0);
    expect(meetings(launched).filter((text) => text.includes('Throwaway'))).toHaveLength(0);
  } finally {
    await closeApp(launched, page);
  }
});

test('Cancel during transcription saves the live draft', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_ASR_OFFLINE_PUSH_MS: '400' });
  try {
    await record(page, 'Cancel draft');
    await expect(page.getByTestId('canvas-lines').locator('li').first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('processing-bar')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Cancel transcription or summary' }).click();
    await expect(page.getByTestId('processing-bar')).toHaveCount(0, { timeout: 30_000 });
    const md = await savedMarkdown(launched, 'Cancel draft');
    expect(md).toContain('Buenos días a todos');
    expect(md).not.toContain('The team went over the plan');
  } finally {
    await closeApp(launched, page);
  }
});

test('a failing summary keeps the transcript and says so', async () => {
  const { launched, page } = await open(
    { VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' },
    { selectedSummaryProvider: 'ClaudeCode' },
  );
  try {
    await record(page, 'Summary fails');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
    const md = await savedMarkdown(launched, 'Summary fails');
    expect(md).toContain('Buenos días a todos');
    expect(md).not.toContain('The team went over the plan');
    await expect(page.getByTestId('status-text')).toContainText(/summary/i, { timeout: 30_000 });
  } finally {
    await closeApp(launched, page);
  }
});

test('the next take after a handed-off summary starts clean', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '4000' });
  try {
    await record(page, 'First take');
    await page.getByRole('textbox', { name: 'Notes' }).click();
    await page.keyboard.type('first take secret note');
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Stop' }).click();
    // The summary still runs in the background when the next take starts.
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('BtnRecord')).toBeEnabled();
    await record(page, 'Second take');
    await expect(page.getByRole('textbox', { name: 'Notes' })).toHaveText('');
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('result-card')).toContainText('Second take', { timeout: 60_000 });
    await expect
      .poll(() => meetings(launched).filter((text) => text.includes('first take secret note')))
      .toHaveLength(1);
    const second = await savedMarkdown(launched, 'Second take');
    expect(second).not.toContain('first take secret note');
  } finally {
    await closeApp(launched, page);
  }
});

test('importing a WAV runs the same pipeline', async () => {
  const { launched, page } = await open();
  try {
    await record(page, 'Source take');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
    const source = files(launched.dataRoot, '.wav')[0] ?? '';
    expect(source).not.toBe('');
    await launched.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
    }, source);
    await expect(page.getByTestId('status-text')).not.toContainText('Generating', {
      timeout: 60_000,
    });
    await page.getByRole('textbox', { name: 'Title' }).fill('Imported take');
    await page.getByTestId('BtnImportAudio').click();
    await expect(page.getByTestId('result-card')).toContainText('Imported take', {
      timeout: 60_000,
    });
    const md = await savedMarkdown(launched, 'Imported take');
    expect(md).toContain('Buenos días a todos');
  } finally {
    await closeApp(launched, page);
  }
});

test('engine not ready: the checklist gates Record', async () => {
  const { launched, page } = await open({}, {}, false);
  try {
    await expect(page.getByTestId('setup-checklist')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('BtnRecord')).toHaveCount(0);
    await expect(page.getByTestId('BtnSetUpToRecord')).toBeVisible();
    await shot(page, 'pipeline-setup-light.png');
  } finally {
    await closeApp(launched, page);
  }
});

test('a capture failure mid-take ends as a typed error and keeps the audio', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_CAPTURE_LOST_MS: '3000' });
  try {
    await record(page, 'Capture fail');
    // The lost source is reported as a typed notice and the take waits for Stop (spec 3.9).
    await expect(page.getByText(/Nothing is being captured/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('BtnStop')).toBeEnabled();
    await page.getByTestId('BtnStop').click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
    expect(files(launched.dataRoot, '.wav').length).toBeGreaterThan(0);
    const md = await savedMarkdown(launched, 'Capture fail');
    expect(md).toContain('Buenos días a todos');
  } finally {
    await closeApp(launched, page);
  }
});

test('closing the window with an active take asks first', async () => {
  const { launched, page } = await open();
  try {
    await record(page, 'Close check');
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    const dialog = page.getByRole('dialog', { name: 'Stop recording before closing?' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Keep recording' }).click();
    await expect(page.getByTestId('BtnStop')).toBeEnabled();
  } finally {
    await closeApp(launched, page);
  }
});
