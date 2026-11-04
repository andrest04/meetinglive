import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The Transcript tab of the session page, in the real app with fake native adapters and a seeded
// throwaway library. Screenshots go to docs/port/screens/session-views and are rewritten only
// with VOZELLA_SCREENSHOTS=1.

test.describe.configure({ timeout: 150_000, mode: 'serial' });

const FULL = '7d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c11';
const EMPTY = '7d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c12';
const LONG = '7d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c13';

const TRANSCRIPT = [
  'Recorded 2026-10-01 22:36',
  'Ended 2026-10-01 23:06',
  '[00:00.00-00:04.52] [ Speaker-1 ] Buenos días a todos.',
  '* [00:04.52-00:09.10] [ Speaker-2 ] Empecemos con el presupuesto.',
  '[00:09.10-00:12.00] Gracias.',
].join('\n');

const LONG_TRANSCRIPT = Array.from(
  { length: 400 },
  (_, i) =>
    `[${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}.00-00:59.00] [ Speaker-${String((i % 3) + 1)} ] Line number ${String(i)} of the long meeting, with enough words to make the text wrap onto a second row in the column.`,
).join('\n');

function seed(dataRoot: string): void {
  const root = path.join(dataRoot, 'meetings');
  writeMeeting(root, {
    id: FULL,
    title: 'Budget review',
    recordedAt: '2026-10-01T22:36:00.0000000+00:00',
    transcript: TRANSCRIPT,
  });
  writeMeeting(root, {
    id: EMPTY,
    title: 'Silent call',
    recordedAt: '2026-10-02T09:00:00.0000000+00:00',
  });
  writeMeeting(root, {
    id: LONG,
    title: 'Long planning session',
    recordedAt: '2026-10-03T09:00:00.0000000+00:00',
    transcript: LONG_TRANSCRIPT,
  });
}

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_E2E_SHOW: '1' }, seed);
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 780);
  });
});

test.afterAll(async () => {
  await launched.close();
});

const open = async (id: string): Promise<void> => {
  await page.evaluate(async (meeting) => {
    await window.vozella.invoke('workspace.dispatch', {
      action: { type: 'selectMeeting', id: meeting },
    });
    await window.vozella.invoke('workspace.dispatch', {
      action: { type: 'openSession', tab: 'Transcript' },
    });
  }, id);
  await expect(page).toHaveURL(/#\/session$/);
};

test('shows the stored lines as written, with the star prefix and stamps in the DOM', async () => {
  await open(FULL);
  const box = page.getByTestId('TxtTranscriptContent');
  await expect(box).toBeVisible();
  const lines = await box.locator('p').allTextContents();
  expect(lines.join('\n')).toBe(TRANSCRIPT);
  expect(lines[3]).toMatch(/^\* \[00:04\.52-00:09\.10\] \[ Speaker-2 \]/);
  await expect(box.getByText('[00:00.00-00:04.52]')).toHaveCSS('font-family', /Mono|monospace/);
});

test('selecting the text and copying gives the stored transcript', async () => {
  const box = page.getByTestId('TxtTranscriptContent');
  await box.focus();
  const selected = await box.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });
  const asLines = (text: string): string[] =>
    text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
  expect(asLines(selected)).toEqual(TRANSCRIPT.split('\n'));
  await launched.app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await page.keyboard.press('Control+C');
  await expect
    .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('* [00:04.52-00:09.10]');
});

test('the header Copy button copies the raw transcript', async () => {
  await launched.app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await page.getByTestId('BtnSessionCopy').click();
  await expect(page.getByTestId('InfoSessionCopy')).toBeVisible();
  const text = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(text.replace(/\r\n/g, '\n').trim()).toBe(TRANSCRIPT);
});

test('the empty state offers the Record button', async () => {
  await open(EMPTY);
  await expect(page.getByTestId('TranscriptEmpty')).toBeVisible();
  await expect(page.getByTestId('TxtTranscriptContent')).toHaveCount(0);
  await page.getByTestId('BtnTranscriptEmptyRecord').click();
  await expect(page).toHaveURL(/#\/record$/);
});

test('a long transcript scrolls vertically only and is keyboard scrollable', async () => {
  await open(LONG);
  const box = page.getByTestId('TxtTranscriptContent');
  await expect(box).toBeVisible();
  const metrics = await box.evaluate((el) => ({
    vertical: el.scrollHeight > el.clientHeight,
    horizontal: el.scrollWidth > el.clientWidth,
  }));
  expect(metrics).toEqual({ vertical: true, horizontal: false });
  await box.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => box.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test.describe('screenshots', () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  const outDir = path.resolve(__dirname, '../../../docs/port/screens/session-views');

  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(350);
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };

  for (const theme of ['light', 'dark'] as const) {
    test(`transcript tab in ${theme}`, async () => {
      await page.evaluate((value) => {
        window.localStorage.setItem('vozella.theme', value);
      }, theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => document.fonts.ready);
      await open(FULL);
      await expect(page.getByTestId('TxtTranscriptContent')).toBeVisible();
      await shot(`transcript-${theme}`);
      await open(LONG);
      await expect(page.getByTestId('TxtTranscriptContent')).toBeVisible();
      await shot(`transcript-long-${theme}`);
      await open(EMPTY);
      await expect(page.getByTestId('TranscriptEmpty')).toBeVisible();
      await shot(`transcript-empty-${theme}`);
    });
  }
});
