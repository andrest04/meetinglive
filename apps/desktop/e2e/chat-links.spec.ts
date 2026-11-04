import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Answer Markdown and links in the chat (chat-9) against the fake provider with a scripted reply.
// The system browser is a double: the fake native build appends each address to a log file.
test.describe.configure({ timeout: 120_000 });

const outDir = path.resolve(__dirname, '../../../docs/port/screens/chat');
const MEETING = 'a0000000-0000-4000-8000-000000000000';
const MISSING = 'b0000000-0000-4000-8000-000000000000';
const hex = (id: string): string => id.replace(/-/g, '');

const REPLY = [
  '## Where it was said',
  `The release date came up in [Weekly planning](https://meetinglive.local/meeting/${hex(MEETING)}).`,
  `An older note, [Old sync](https://meetinglive.local/meeting/${hex(MISSING)}), was deleted.`,
  'Read the [release guide](https://example.com/guide/) or [do not click](javascript:alert(1)).',
  '',
  '| Who | When |',
  '| --- | --- |',
  '| Ana | Friday |',
  '',
  '<b>raw html</b> and `inline code`',
].join('\n');

const seed = (dataRoot: string): void => {
  writeMeeting(path.join(dataRoot, 'meetings'), {
    id: MEETING,
    title: 'Weekly planning',
    recordedAt: '2026-09-03T10:30:00.0000000-05:00',
    summary: 'Agreed the scope for the September release.',
    transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
  });
};

async function open(openedLog: string): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp(
    {
      VOZELLA_E2E_SHOW: '1',
      VOZELLA_FAKE_CHAT_REPLY: REPLY,
      VOZELLA_FAKE_OPENED_LOG: openedLog,
    },
    seed,
  );
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
  await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
  await page.getByTestId('BarMeetingChat').getByRole('button', { expanded: false }).first().click();
  await page.getByTestId('TxtMeetingChat').fill('When is the release?');
  await page.getByTestId('BtnMeetingChatSend').click();
  await expect(page.getByTestId('ListMeetingChat').getByRole('table')).toBeVisible();
  return { launched, page };
}

async function shot(page: Page, name: string): Promise<void> {
  if (process.env.VOZELLA_SCREENSHOTS !== '1') return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

const logPath = (): string =>
  path.join(os.tmpdir(), `vozella-chat-links-${String(process.pid)}.log`);

test('answers render Markdown, citations navigate, web links use the opener double', async () => {
  const log = logPath();
  fs.rmSync(log, { force: true });
  const { launched, page } = await open(log);
  try {
    const list = page.getByTestId('ListMeetingChat');
    await expect(list.getByRole('heading', { name: 'Where it was said' })).toBeVisible();
    await expect(list.getByRole('cell', { name: 'Friday' })).toBeVisible();
    await expect(list.getByText('<b>raw html</b>')).toBeVisible();
    await expect(list.locator('b')).toHaveCount(0);
    await expect(list.getByRole('link', { name: 'do not click' })).toHaveCount(0);
    await expect(list.getByText('do not click')).toBeVisible();
    await expect(list.getByRole('link', { name: 'release guide' })).toHaveAttribute(
      'title',
      'https://example.com/guide/',
    );
    await shot(page, 'chat-links-answer-light');

    // A web link goes to the opener double and the page stays where it is.
    await list.getByRole('link', { name: 'release guide' }).click();
    await expect
      .poll(() => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''))
      .toBe('https://example.com/guide/\n');
    await expect(page).not.toHaveURL(/#\/session$/);

    // A javascript: link is plain text: nothing to click, nothing recorded.
    expect(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);

    // A missing meeting shows the notice and does not navigate.
    await list.getByRole('link', { name: 'Old sync' }).click();
    const notice = page.getByTestId('InfoMeetingChatError');
    await expect(notice).toContainText('That meeting no longer exists.');
    await expect(page).not.toHaveURL(/#\/session$/);
    await shot(page, 'chat-links-missing-light');

    // A found meeting opens its Summary tab.
    await list.getByRole('link', { name: 'Weekly planning' }).click();
    await expect(page).toHaveURL(/#\/session$/);
    await expect(page.getByRole('heading', { name: 'Weekly planning', level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Enhanced' })).toBeChecked();
    await expect(page.getByTestId('BtnRegenerateSummary')).toBeVisible();
  } finally {
    await launched.close();
    fs.rmSync(log, { force: true });
  }
});

test('copy puts the raw Markdown on the clipboard; dark theme', async () => {
  const log = logPath();
  const { launched, page } = await open(log);
  try {
    await page.getByTestId('BtnMeetingChatCopy').click();
    await expect
      .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(REPLY);

    await page.evaluate(() => {
      window.localStorage.setItem('vozella.theme', 'dark');
    });
    await page.reload();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page
      .getByTestId('BarMeetingChat')
      .getByRole('button', { expanded: false })
      .first()
      .click();
    await shot(page, 'chat-links-answer-dark');
  } finally {
    await launched.close();
    fs.rmSync(log, { force: true });
  }
});
