import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The chat conversation (chat-7) against the fake summary provider: nothing touches a model, a CLI
// or the network. Screenshots land in docs/port/screens/chat/ when VOZELLA_SCREENSHOTS=1.
test.describe.configure({ timeout: 120_000 });

const outDir = path.resolve(__dirname, '../../../docs/port/screens/chat');
const MEETING = 'a0000000-0000-4000-8000-000000000000';

const seed = (dataRoot: string): void => {
  writeMeeting(path.join(dataRoot, 'meetings'), {
    id: MEETING,
    title: 'Weekly planning',
    recordedAt: '2026-09-03T10:30:00.0000000-05:00',
    summary: 'Agreed the scope for the September release.',
    transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
  });
};

async function open(env: Record<string, string>): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1', ...env }, seed);
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
  return { launched, page };
}

async function shot(page: Page, name: string): Promise<void> {
  if (process.env.VOZELLA_SCREENSHOTS !== '1') return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

/** Opens the AI panel from the launcher; it may already be open, since the panel remembers. */
const openPanel = async (page: Page): Promise<void> => {
  const launcher = page.getByTestId('BtnAiPanelOpen');
  const composer = page.getByTestId('TxtMeetingChat');
  // The closed panel keeps its composer in the DOM, so only the visible one counts.
  await expect(launcher.or(composer).filter({ visible: true })).toBeVisible();
  if (await launcher.isVisible()) await launcher.click();
  await expect(composer).toBeVisible();
};

test('ask a question: Thinking, then streamed Markdown, copy and New chat', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '1500' });
  try {
    await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
    await openPanel(page);
    await expect(page.getByTestId('ListMeetingChatStarters').getByRole('button')).toHaveCount(3);
    await expect(page.getByTestId('BtnMeetingChatSend')).toBeDisabled();
    await shot(page, 'chat-conversation-empty-light');

    await page.getByTestId('TxtMeetingChat').fill('What did we decide?');
    await expect(page.getByTestId('BtnMeetingChatSend')).toBeEnabled();
    await page.getByTestId('TxtMeetingChat').press('Enter');

    const list = page.getByTestId('ListMeetingChat');
    await expect(list.getByText('What did we decide?')).toBeVisible();
    await expect(list.getByText('Thinking…')).toBeVisible();
    await expect(page.getByTestId('TxtMeetingChat')).toHaveValue('');
    await expect(page.getByTestId('ListMeetingChatStarters')).toHaveCount(0);
    await expect(page.getByTestId('BtnMeetingChatStop')).toBeVisible();
    await expect(page.getByTestId('BtnMeetingChatNew')).toBeDisabled();
    await shot(page, 'chat-conversation-thinking-light');

    await expect(list.getByText('The team went over the plan')).toBeVisible();
    await expect(list.getByRole('heading', { name: 'Action items' })).toBeVisible();
    await expect(list.getByRole('listitem', { name: /^Assistant: / })).toBeVisible();
    await expect(page.getByTestId('BtnMeetingChatStop')).toHaveCount(0);
    await shot(page, 'chat-conversation-answer-light');

    await page.getByTestId('BtnMeetingChatCopy').click();
    await expect
      .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain('The team went over the plan');

    await page.getByTestId('BtnMeetingChatNew').click();
    await expect(page.getByTestId('ListMeetingChat')).toHaveCount(0);
    await expect(page.getByTestId('ListMeetingChatStarters')).toBeVisible();
  } finally {
    await launched.close();
  }
});

test('a starter chip sends its prompt at once and stop returns the draft', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '8000' });
  try {
    await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
    await openPanel(page);
    await page.getByTestId('ListMeetingChatStarters').getByRole('button').first().click();
    const list = page.getByTestId('ListMeetingChat');
    await expect(list.getByText('Thinking…')).toBeVisible();
    await page.getByTestId('BtnMeetingChatStop').click();
    await expect(page.getByTestId('ListMeetingChat')).toHaveCount(0);
    await expect(page.getByTestId('InfoMeetingChatError')).toHaveCount(0);
    await expect(page.getByTestId('TxtMeetingChat')).toHaveValue(/\S/);
  } finally {
    await launched.close();
  }
});

test('a failing provider removes the rows, restores the draft and shows a closable notice', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' });
  try {
    await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
    await openPanel(page);
    await page.getByTestId('TxtMeetingChat').fill('Will this fail?');
    await page.getByTestId('BtnMeetingChatSend').click();
    const notice = page.getByTestId('InfoMeetingChatError');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Could not answer');
    await expect(page.getByTestId('ListMeetingChat')).toHaveCount(0);
    await expect(page.getByTestId('TxtMeetingChat')).toHaveValue('Will this fail?');
    await shot(page, 'chat-conversation-error-light');
    await notice.getByRole('button', { name: 'Close' }).click();
    await expect(notice).toHaveCount(0);
  } finally {
    await launched.close();
  }
});

test('dark theme and Spanish', async () => {
  const { launched, page } = await open({});
  try {
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
    await page.evaluate(() => {
      window.localStorage.setItem('vozella.theme', 'dark');
    });
    await page.reload();
    await expect(page.getByRole('navigation')).toBeVisible();
    await openPanel(page);
    await expect(page.getByTestId('TxtMeetingChat')).toHaveAttribute(
      'placeholder',
      'Pregunta sobre tus reuniones',
    );
    await page.getByTestId('TxtMeetingChat').fill('¿Qué se decidió?');
    await page.getByTestId('TxtMeetingChat').press('Enter');
    const list = page.getByTestId('ListMeetingChat');
    await expect(list.getByRole('listitem', { name: /^Asistente: / })).toBeVisible();
    await expect(list.getByRole('listitem', { name: /^Tú: / }).first()).toBeVisible();
    await shot(page, 'chat-conversation-answer-dark');
  } finally {
    await launched.close();
  }
});
