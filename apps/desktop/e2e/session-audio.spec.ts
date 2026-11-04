import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// Playing the saved audio from the Transcript tab (recorded improvement, spec 7 item 21 / B21).
// The audio is a generated three second wav; the library is a throwaway data root.
// Screenshots are rewritten only with VOZELLA_SCREENSHOTS=1.

test.describe.configure({ timeout: 150_000, mode: 'serial' });

const WITH_AUDIO = '7d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9d21';
const NO_AUDIO = '7d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9d22';

const TRANSCRIPT = [
  '[00:00.00-00:01.00] [ Speaker-1 ] Buenos días a todos.',
  '* [00:01.00-00:02.00] [ Speaker-2 ] Empecemos con el presupuesto.',
  '[00:02.00-00:03.00] [ Speaker-1 ] Gracias por venir.',
].join('\n');

/** Mono 16-bit PCM wav with a quiet tone, `seconds` long. */
function makeWav(seconds: number): Buffer {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 1500), 44 + i * 2);
  }
  return buffer;
}

function seedMeeting(root: string, id: string, title: string, audio: string): void {
  const dir = path.join(root, 'meetings', 'Inbox');
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    'recordedAt: 2026-10-01T22:36:00.0000000+00:00',
    `audioFilePath: ${audio}`,
    '---',
    '',
    '## Transcript',
    '',
    TRANSCRIPT,
    '',
  ];
  fs.writeFileSync(path.join(dir, `2026-10-01 ${title}.md`), lines.join('\n'), 'utf8');
}

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_E2E_SHOW: '1' }, (dataRoot) => {
    const wav = path.join(dataRoot, 'take.wav');
    fs.writeFileSync(wav, makeWav(3));
    seedMeeting(dataRoot, WITH_AUDIO, 'Budget review', wav);
    seedMeeting(dataRoot, NO_AUDIO, 'Silent call', '');
  });
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

const audioState = () =>
  page.getByTestId('AudioElement').evaluate((el) => {
    const audio = el as HTMLAudioElement;
    return { paused: audio.paused, time: audio.currentTime, duration: audio.duration };
  });

test('the player appears only when the meeting has audio', async () => {
  await open(NO_AUDIO);
  await expect(page.getByTestId('TxtTranscriptContent')).toBeVisible();
  await expect(page.getByTestId('AudioBar')).toHaveCount(0);
  await open(WITH_AUDIO);
  await expect(page.getByTestId('AudioBar')).toBeVisible();
  await expect(page.getByTestId('AudioClock')).toHaveText('0:00 / 0:03');
});

test('play and pause move the real element', async () => {
  await page.getByRole('button', { name: 'Play audio' }).click();
  await expect.poll(async () => (await audioState()).paused).toBe(false);
  await expect.poll(async () => (await audioState()).time).toBeGreaterThan(0.1);
  await page.getByRole('button', { name: 'Pause audio' }).click();
  await expect.poll(async () => (await audioState()).paused).toBe(true);
});

test('the scrubber answers the keyboard', async () => {
  await page.getByTestId('AudioScrubber').focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await audioState()).time).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await audioState()).time).toBeGreaterThan(0);
});

test('clicking a stamped line seeks there and plays; a selection does not', async () => {
  await page.getByText(/Gracias por venir/).click();
  await expect.poll(async () => (await audioState()).time).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await audioState()).paused).toBe(false);
  await page.getByRole('button', { name: 'Pause audio' }).click();
  await page.getByTestId('AudioScrubber').focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await audioState()).time).toBe(0);
  // Drag across the words of the first line: selects text, leaves the position alone.
  const line = page.getByText(/Buenos días a todos/);
  const box = await line.boundingBox();
  if (!box) throw new Error('line not laid out');
  await page.mouse.move(box.x + 120, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
  expect(selected).toBeGreaterThan(0);
  const state = await audioState();
  expect(state.paused).toBe(true);
  expect(state.time).toBe(0);
});

test('the media route answers Range with 206, refuses unknown ids and traversal', async () => {
  const result = await page.evaluate(
    async ({ id, other }) => {
      const base = 'vozella://app/media/';
      const ranged = await fetch(base + id, { headers: { Range: 'bytes=0-9' } });
      const missing = await fetch(base + other);
      const traversal = await fetch(base + '..%2F..%2Fpackage.json');
      return {
        status: ranged.status,
        range: ranged.headers.get('Content-Range'),
        length: (await ranged.arrayBuffer()).byteLength,
        missing: missing.status,
        traversal: traversal.status,
      };
    },
    { id: WITH_AUDIO, other: NO_AUDIO },
  );
  expect(result.status).toBe(206);
  expect(result.range).toMatch(/^bytes 0-9\/\d+$/);
  expect(result.length).toBe(10);
  expect(result.missing).toBe(404);
  expect(result.traversal).not.toBe(200);
});

test.describe('screenshots', () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  const outDir = path.resolve(__dirname, '../../../docs/port/screens/session-views');

  for (const theme of ['light', 'dark'] as const) {
    test(`transcript with audio in ${theme}`, async () => {
      await page.evaluate((value) => {
        window.localStorage.setItem('vozella.theme', value);
      }, theme);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(() => document.fonts.ready);
      await open(WITH_AUDIO);
      await expect(page.getByTestId('AudioClock')).toHaveText('0:00 / 0:03');
      await page.getByText(/Empecemos/).click();
      await page.getByRole('button', { name: 'Pause audio' }).click();
      await page.waitForTimeout(350);
      fs.mkdirSync(outDir, { recursive: true });
      await page.screenshot({ path: path.join(outDir, `transcript-audio-${theme}.png`) });
    });
  }
});
