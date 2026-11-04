import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, type LaunchedApp } from './launch';

// R11 in the real window on the fake native build: the processing bar and its Cancel, the quiet
// Cancel summary after the hand-off, the retry action, the typed live ask with its answer card and
// the app close dialogs. Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/recording.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/recording');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

test.describe.configure({ mode: 'serial', timeout: 150_000 });

const seed = (provider: 'Local' | 'ClaudeCode') => (root: string) => {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', 'settings.json'),
    JSON.stringify({ selectedSummaryProvider: provider, selectedSummaryModelId: MODEL }),
  );
};

async function open(
  env: Record<string, string>,
  provider: 'Local' | 'ClaudeCode' = 'Local',
): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp(
    { ...readyEnv, VOZELLA_E2E_SHOW: shots ? '1' : '0', ...env },
    seed(provider),
  );
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 900);
  });
  await page.getByRole('link', { name: 'Record' }).click();
  await installEngine(page);
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  return { launched, page };
}

/** Ends a take still running, so the close protection does not wait for an answer. */
async function closeApp(launched: LaunchedApp, page: Page): Promise<void> {
  await page.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, name) });
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

async function startTake(page: Page, title: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 });
}

test('Cancel during transcribing stops the run and keeps the take', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_ASR_OFFLINE_PUSH_MS: '400' });
  try {
    await startTake(page, 'Cancel check');
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Stop' }).click();
    const bar = page.getByTestId('processing-bar');
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('recording-status')).toContainText('Transcribing audio');
    await expect(page.getByTestId('recording-status')).toHaveAttribute('aria-live', 'polite');
    const cancel = page.getByRole('button', { name: 'Cancel transcription or summary' });
    await expect(cancel).toBeEnabled();
    expect(await serious(page)).toEqual([]);
    await shot(page, 'processing-bar-light.png');
    await setTheme(page, 'dark');
    await expect(bar).toBeVisible();
    await shot(page, 'processing-bar-dark.png');
    await cancel.click();
    await expect(bar).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeEnabled();
    await expect(page.getByTestId('status-text')).toContainText(/Cancelled/);
  } finally {
    await closeApp(launched, page);
  }
});

test('after the hand-off the summary can be cancelled from the result card', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '20000' });
  try {
    await startTake(page, 'Summary cancel');
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Stop' }).click();
    const card = page.getByTestId('result-card');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('processing-bar')).toHaveCount(0);
    await expect(page.getByTestId('status-text')).toContainText('Generating summary');
    const cancel = card.getByRole('button', { name: 'Cancel summary' });
    await expect(cancel).toBeVisible();
    expect(await serious(page)).toEqual([]);
    await shot(page, 'cancel-summary-light.png');
    await setTheme(page, 'dark');
    await expect(cancel).toBeVisible();
    await shot(page, 'cancel-summary-dark.png');
    await cancel.click();
    await expect(cancel).toHaveCount(0, { timeout: 30_000 });
    await expect(card).toContainText('Summary cancel');
    // The transcript stays: the meeting has no summary section.
    const meeting = await page.evaluate(async () => {
      const state = await window.vozella.invoke('recording.getState', {});
      const id = state.lastMeeting?.id ?? '';
      const result = await window.vozella.invoke('library.getMeeting', { id });
      return { summary: result.record?.summary ?? null, transcript: result.record?.transcript };
    });
    expect(meeting.summary).toBeNull();
    expect(meeting.transcript ?? '').not.toBe('');
  } finally {
    await closeApp(launched, page);
  }
});

test('a typed question during a take is answered in the side panel, with the web toggle kept', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '600' }, 'ClaudeCode');
  try {
    await startTake(page, 'Ask check');
    const box = page.getByRole('textbox', { name: 'Type a question' });
    await expect(box).toHaveAttribute('id', 'TxtLiveAsk');
    await expect(box).toHaveAttribute('placeholder', 'Type a question, then press Ctrl+Enter');
    const toggle = page.getByRole('button', { name: 'Search the web for the answer' });
    await expect(toggle).toBeEnabled({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await box.fill('What did we decide about the budget?');
    await box.press('Enter');
    await expect(page.getByTestId('answer-card')).toHaveCount(0);
    await box.press('Control+Enter');
    await expect(page.getByRole('progressbar', { name: 'Answering' })).toBeVisible();
    const card = page.getByTestId('answer-card');
    await expect(card).toContainText('The team went over the plan', { timeout: 30_000 });
    await expect(card.getByRole('heading', { name: 'Answer' })).toBeVisible();
    await expect(card).not.toContainText('Searched the web');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await box.press('Control+Enter');
    await expect(card).toContainText('Searched the web', { timeout: 30_000 });
    expect(await serious(page)).toEqual([]);
    await page.mouse.move(700, 100);
    await shot(page, 'live-ask-light.png');
    await setTheme(page, 'dark');
    // The page reloaded, so the answer is gone: ask again to draw the dark card.
    const again = page.getByRole('textbox', { name: 'Type a question' });
    await again.fill('Who owns the next step?');
    await again.press('Control+Enter');
    await expect(page.getByTestId('answer-card')).toContainText('The team went over the plan', {
      timeout: 30_000,
    });
    await page.mouse.move(700, 100);
    await shot(page, 'live-ask-dark.png');
    // The toggle outlives the take.
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
    await startTake(page, 'Second take');
    await expect(
      page.getByRole('button', { name: 'Search the web for the answer' }),
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByTestId('answer-card')).toHaveCount(0);
  } finally {
    await closeApp(launched, page);
  }
});

test('a failing provider shows Could not answer and the take goes on', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' }, 'ClaudeCode');
  try {
    await startTake(page, 'Ask error');
    const box = page.getByRole('textbox', { name: 'Type a question' });
    await box.fill('Who owns the next step?');
    await box.press('Control+Enter');
    const error = page.getByRole('alert').filter({ hasText: 'Could not answer' });
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
    await shot(page, 'live-ask-error-light.png');
  } finally {
    await closeApp(launched, page);
  }
});

test('closing the window while recording asks first, and Keep recording keeps the take', async () => {
  const { launched, page } = await open({});
  try {
    await startTake(page, 'Close check');
    await launched.app.evaluate(({ BrowserWindow }) => {
      // The pill window exists during a take and may be listed first: close the main window.
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('/index.html'))
        ?.close();
    });
    const dialog = page.getByRole('dialog', { name: 'Stop recording before closing?' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: 'Keep recording' })).toBeFocused();
    expect(await serious(page)).toEqual([]);
    await shot(page, 'close-confirm-light.png');
    await dialog.getByRole('button', { name: 'Keep recording' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
    await setTheme(page, 'dark');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  } finally {
    await page
      .evaluate(() => window.vozella.invoke('recording.discard', {}))
      .catch(() => undefined);
    await closeApp(launched, page);
  }
});

test('the saving dialog cannot be dismissed and the failure dialog defaults to Keep open', async () => {
  const { launched, page } = await open({});
  try {
    const send = (dialog: string, requestId: string) =>
      launched.app.evaluate(
        ({ BrowserWindow }, payload) => {
          BrowserWindow.getAllWindows()[0]?.webContents.send('recording.closeRequest', payload);
        },
        { requestId, dialog },
      );
    await send('saving', 's1');
    const saving = page.getByRole('dialog', { name: 'Saving your recording' });
    await expect(saving).toBeVisible();
    await expect(saving.getByRole('button')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(saving).toBeVisible();
    await shot(page, 'close-saving-light.png');
    await send('done', 's1');
    await expect(saving).toHaveCount(0);
    await send('save-failed', 'f1');
    const failed = page.getByRole('dialog', { name: 'The recording could not be saved' });
    await expect(failed).toBeVisible();
    await expect(failed.getByRole('button', { name: 'Keep open' })).toBeFocused();
    await setTheme(page, 'dark');
    await send('save-failed', 'f2');
    await expect(failed).toBeVisible();
    await shot(page, 'close-failed-dark.png');
    await failed.getByRole('button', { name: 'Keep open' }).click();
    await expect(failed).toHaveCount(0);
  } finally {
    await closeApp(launched, page);
  }
});
