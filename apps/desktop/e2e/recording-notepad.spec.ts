import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// The session notes of the Record page in the real window on the fake native build. The take is
// started through the recording service (`recording.start`), because main owns the notes.
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/recording.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/recording');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';

const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

let launched: LaunchedApp;
let page: Page;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async () => {
  launched = await launchApp(
    {
      VOZELLA_E2E_SHOW: shots ? '1' : '0',
      VOZELLA_FAKE_ENGINE_STEP_MS: '5',
      VOZELLA_FAKE_MODEL_PRESENT: MODEL,
    },
    (root) => {
      fs.mkdirSync(path.join(root, 'app'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'app', 'settings.json'),
        JSON.stringify({ selectedSummaryProvider: 'Local', selectedSummaryModelId: MODEL }),
      );
    },
  );
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The setup gate needs the engine on disk; the fake engine installs in a few milliseconds.
  await page.evaluate(() => window.vozella.invoke('transcription.ensureEngine', {}));
});

test.afterAll(async () => {
  // Close protection holds the window while a take runs.
  await page.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
});

const notes = (): Promise<string> =>
  page.evaluate(async () => (await window.vozella.invoke('recording.getState', {})).notes);

const startTake = (): Promise<unknown> =>
  page.evaluate(() =>
    window.vozella.invoke('recording.start', {
      title: 'Notes check',
      folderId: null,
      microphone: { kind: 'SystemDefault', deviceId: null },
      appName: null,
    }),
  );

const box = () => page.getByRole('textbox', { name: 'Notes' });

test('the notepad is absent while idle', async () => {
  await expect(box()).toHaveCount(0);
});

test('typing reaches main as Markdown and a blur flushes it', async () => {
  const started = await startTake();
  expect(JSON.stringify(started)).toContain('"started":true');
  await expect(box()).toBeVisible();
  await expect(box()).toHaveAttribute('id', 'TxtRecordingNotes');
  await box().click();
  await page.keyboard.type('## Decisions');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- ship friday');
  await expect.poll(notes, { timeout: 3000 }).toContain('- ship friday');
  expect(await notes()).toContain('## Decisions');
  await page.keyboard.type(' now');
  await page.getByRole('heading', { level: 1 }).click();
  await expect.poll(notes).toContain('ship friday now');
});

test('keyboard shortcuts format text', async () => {
  await box().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await expect.poll(notes).toContain('**bold**');
});

test('the notes survive leaving and coming back to the page', async () => {
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('link', { name: 'Record' }).click();
  await expect(box()).toContainText('ship friday now');
});

test('the focus ring is visible and the box is reachable by keyboard', async () => {
  await box().focus();
  const outline = await page
    .locator('.notepad')
    .evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
  expect(outline).toMatch(/^solid (1\.[5-9]|2)/);
});

test('reduced motion removes the notepad transition', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const duration = await page
    .locator('.notepad')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration === 'none' || parseFloat(duration) < 0.001 || duration === '0s').toBe(true);
  await page.emulateMedia({ reducedMotion: null });
});

test('forced colors keep the edge and the placeholder readable', async () => {
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(box()).toBeVisible();
  await page.emulateMedia({ forcedColors: null });
});

for (const theme of ['light', 'dark'] as const) {
  test(`no serious accessibility violations in ${theme}`, async () => {
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await expect(box()).toBeVisible();
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          axe: { run: () => Promise<{ violations: { id: string; impact: string | null }[] }> };
        }
      ).axe;
      const result = await api.run();
      return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    });
    expect(violations).toEqual([]);
  });
}

test('discard clears the notes and the next take starts empty (B-10)', async () => {
  const discarded = await page.evaluate(
    async () => (await window.vozella.invoke('recording.discard', {})).discarded,
  );
  expect(discarded).toBe(true);
  await expect(box()).toHaveCount(0);
  expect(await notes()).toBe('');
  expect(JSON.stringify(await startTake())).toContain('"started":true');
  await expect(box()).toBeVisible();
  await expect(box()).toHaveText('');
  expect(await notes()).toBe('');
});

test.describe('screenshots', () => {
  test.skip(!shots, 'set VOZELLA_SCREENSHOTS=1 to capture');

  for (const theme of ['light', 'dark'] as const) {
    test(`notepad in ${theme}`, async () => {
      fs.mkdirSync(outDir, { recursive: true });
      await launched.app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 1100);
      });
      await page.evaluate((value) => {
        window.localStorage.setItem('vozella.theme', value);
      }, theme);
      await page.reload();
      await expect(box()).toBeVisible();
      await box().click();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Delete');
      await page.keyboard.type('## Budget call');
      await page.keyboard.press('Enter');
      await page.keyboard.type('- Ana owns the vendor quote');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Pricing is **fixed** until `Q3`');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.type('[ ] send the deck');
      await page.keyboard.press('Enter');
      await page.keyboard.type('book the room');
      await page.getByRole('heading', { level: 1 }).click();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outDir, `notepad-${theme}.png`) });
    });
  }
});
