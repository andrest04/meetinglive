import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The Recipes flyout (chat-8) against the fake summary provider. Screenshots land in
// docs/port/screens/chat/ when VOZELLA_SCREENSHOTS=1.
test.describe.configure({ timeout: 120_000 });

const outDir = path.resolve(__dirname, '../../../docs/port/screens/chat');
const WORK = '33333333-3333-4333-8333-333333333333';

const seed = (dataRoot: string): void => {
  const root = path.join(dataRoot, 'meetings');
  fs.mkdirSync(path.join(root, 'Trabajo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'folders.json'),
    JSON.stringify([
      {
        id: WORK,
        name: 'Trabajo',
        parentId: null,
        note: null,
        colorKey: 'amber',
        iconKey: 'briefcase',
        createdAt: '2026-08-20T12:00:00-05:00',
      },
    ]),
    'utf8',
  );
  writeMeeting(root, {
    id: 'a0000000-0000-4000-8000-000000000000',
    title: 'Weekly planning',
    recordedAt: '2026-09-03T10:30:00.0000000-05:00',
    summary: 'Agreed the scope for the September release.',
    transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
  });
};

async function open(
  env: Record<string, string> = {},
): Promise<{ launched: LaunchedApp; page: Page }> {
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

const expandBar = async (page: Page): Promise<void> => {
  await page.getByTestId('BarMeetingChat').getByRole('button', { expanded: false }).first().click();
  await expect(page.getByTestId('TxtMeetingChat')).toBeVisible();
};

const openMeeting = async (page: Page): Promise<void> => {
  await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  await page
    .getByRole('grid', { name: 'Library' })
    .getByRole('row', { name: /Weekly planning/ })
    .dblclick();
  await expect(page.getByTestId('LblMeetingChatScope')).toHaveText('Meeting: Weekly planning');
};

test('a meeting scope lists five recipes, a folder scope lists three', async () => {
  const { launched, page } = await open();
  try {
    await openMeeting(page);
    await expandBar(page);
    const button = page.getByTestId('BtnMeetingChatRecipes');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const options = page.getByTestId('ListMeetingChatRecipes').getByRole('option');
    await expect(options).toHaveCount(5);
    await shot(page, 'chat-recipes-flyout-light');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ListMeetingChatRecipes')).toHaveCount(0);

    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('treeitem', { name: /Trabajo/ }).click();
    await expect(page.getByTestId('LblMeetingChatScope')).toHaveText('Folder: Trabajo');
    await expandBar(page);
    await page.getByTestId('BtnMeetingChatRecipes').click();
    await expect(page.getByTestId('ListMeetingChatRecipes').getByRole('option')).toHaveCount(3);
  } finally {
    await launched.close();
  }
});

test('typing /ac filters, a click fills the draft without sending', async () => {
  const { launched, page } = await open();
  try {
    await openMeeting(page);
    await expandBar(page);
    const field = page.getByTestId('TxtMeetingChat');
    await field.click();
    await field.pressSequentially('/ac');
    const options = page.getByTestId('ListMeetingChatRecipes').getByRole('option');
    await expect(options).toHaveCount(1);
    await expect(field).toBeFocused();
    await shot(page, 'chat-recipes-slash-light');

    const prompt = (await options.first().locator('span').nth(1).innerText()).trim();
    await options.first().click();
    await expect(field).toHaveValue(/Extract owners and next steps/);
    await expect(page.getByTestId('ListMeetingChatRecipes')).toHaveCount(0);
    await expect(field).toBeFocused();
    await expect(page.getByTestId('ListMeetingChat')).toHaveCount(0);
    expect(prompt).toContain('Extract owners');
    const caret = await field.evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.value.length,
    ]);
    expect(caret[0]).toBe(caret[1]);
  } finally {
    await launched.close();
  }
});

test('a chip click sends and streams the answer (item 107)', async () => {
  const { launched, page } = await open();
  try {
    await openMeeting(page);
    await expandBar(page);
    await page.getByTestId('ListMeetingChatStarters').getByRole('button').first().click();
    const list = page.getByTestId('ListMeetingChat');
    await expect(list.getByText('The team went over the plan')).toBeVisible();
    await expect(page.getByTestId('TxtMeetingChat')).toHaveValue('');
  } finally {
    await launched.close();
  }
});

test('dark theme and Spanish', async () => {
  const { launched, page } = await open();
  try {
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
    await page.evaluate(() => {
      window.localStorage.setItem('vozella.theme', 'dark');
    });
    await page.reload();
    await expect(page.getByRole('navigation')).toBeVisible();
    await expandBar(page);
    const button = page.getByTestId('BtnMeetingChatRecipes');
    await expect(button).toHaveAccessibleName('Recetas');
    await button.click();
    await expect(page.getByTestId('ListMeetingChatRecipes').getByRole('option')).toHaveCount(3);
    await shot(page, 'chat-recipes-flyout-dark');
  } finally {
    await launched.close();
  }
});
