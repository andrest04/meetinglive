import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, type LaunchedApp } from './launch';

// Live question detection on the fake native build. The fake speech engine reads a question as
// its second phrase (VOZELLA_FAKE_ASR_QUESTION=1, 3 to 6 s of audio). The card shows on the Record
// page; Answer asks it through the live ask against the fake summary provider (no real CLI, no
// account); Dismiss puts it away and the same question said again does not bring it back.
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/recording.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/recording');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';
const QUESTION = '¿Cuál es el tercer principio del manifiesto ágil?';

test.describe.configure({ mode: 'serial', timeout: 150_000 });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp(
    {
      ...readyEnv,
      VOZELLA_E2E_SHOW: shots ? '1' : '0',
      VOZELLA_FAKE_ASR_QUESTION: '1',
      VOZELLA_FAKE_SUMMARY_DELAY_MS: '300',
    },
    (root) => {
      fs.mkdirSync(path.join(root, 'app'), { recursive: true });
      // A CLI engine: the default mode is rules+ai, so the card goes through the engine check.
      fs.writeFileSync(
        path.join(root, 'app', 'settings.json'),
        JSON.stringify({ selectedSummaryProvider: 'ClaudeCode', selectedSummaryModelId: MODEL }),
      );
    },
  );
  page = await launched.app.firstWindow();
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
});

test.afterAll(async () => {
  await page.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
});

async function startTake(title: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 30_000 });
}

async function endTake(): Promise<void> {
  await page.evaluate(() => window.vozella.invoke('recording.discard', {}));
  await expect(page.getByRole('button', { name: 'Record', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

const card = () => page.getByRole('region', { name: 'Question detected' });

async function serious(): Promise<{ id: string; impact: string | null }[]> {
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

test('a spoken question shows a card; Answer streams the answer and the card goes', async () => {
  await startTake('Question check');
  await expect(card()).toBeVisible({ timeout: 30_000 });
  await expect(card().getByTestId('LiveQuestionBody')).toHaveText(QUESTION);
  // The fake engine never says yes or no: the check fails and the rules result stands.
  await expect(card()).toHaveAttribute('data-confirmed', 'true', { timeout: 15_000 });
  // One polite region speaks per window: the dock's (the AI panel copy stays silent).
  await expect(
    page.getByTestId('LiveQuestionAnnouncement').filter({ hasText: QUESTION }),
  ).toHaveText(`Question detected: ${QUESTION}`);
  // Nothing is answered without the user.
  await expect(page.getByTestId('answer-card')).toHaveCount(0);
  expect(await serious()).toEqual([]);
  if (shots) {
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'live-question-card.png') });
  }

  await card().getByRole('button', { name: 'Answer' }).click();
  await expect(page.getByTestId('answer-card')).toContainText('The team went over the plan', {
    timeout: 30_000,
  });
  await expect(card()).toHaveCount(0);
  await endTake();
});

test('Dismiss hides the card and the same question said again does not bring it back', async () => {
  await startTake('Dismiss check');
  await expect(card()).toBeVisible({ timeout: 30_000 });
  await card().getByRole('button', { name: 'Dismiss' }).click();
  await expect(card()).toHaveCount(0);
  // The script repeats every 12 s: wait until the question is committed a second time.
  const canvas = page.getByTestId('live-canvas');
  await expect
    .poll(async () => (await canvas.innerText()).split('tercer principio').length - 1, {
      timeout: 40_000,
    })
    .toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);
  await expect(card()).toHaveCount(0);
  await endTake();
});

test('Ctrl+Enter outside a text box answers the card of a new take', async () => {
  await startTake('Shortcut check');
  await expect(card()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('answer-card')).toContainText('The team went over the plan', {
    timeout: 30_000,
  });
  await expect(card()).toHaveCount(0);
  await endTake();
});

test('the AI panel shows the Live badge and the live chips; Summary so far answers', async () => {
  await startTake('Live panel check');
  const launcher = page.getByTestId('BtnAiPanelOpen');
  const composer = page.getByTestId('TxtMeetingChat');
  // The panel remembers whether it was open; only the visible control counts.
  await expect(launcher.or(composer).filter({ visible: true })).toBeVisible();
  if (await launcher.isVisible()) await launcher.click();
  await expect(composer).toBeVisible();

  await expect(page.getByTestId('BadgeChatLive')).toHaveText('Live');
  const chips = page.getByTestId('ListMeetingChatStarters');
  await expect(chips.getByRole('button')).toHaveText([
    'Catch me up (last 2 min)',
    'Summary so far',
    'Suggest questions',
    'Decisions and tasks',
  ]);
  expect(await serious()).toEqual([]);
  if (shots) {
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'live-ai-panel.png') });
  }

  await chips.getByRole('button', { name: 'Summary so far' }).click();
  const list = page.getByTestId('ListMeetingChat');
  await expect(list.getByText(/^Summarize the recording so far/)).toBeVisible();
  await expect(list.getByText('The team went over the plan')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('BtnMeetingChatStop')).toHaveCount(0);
  await endTake();
  await expect(page.getByTestId('BadgeChatLive')).toHaveCount(0);
});
