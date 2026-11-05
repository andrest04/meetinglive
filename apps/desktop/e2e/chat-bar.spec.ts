import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Chat bar in the shell (chat-6). Screenshots land in docs/port/screens/chat/ when
// VOZELLA_SCREENSHOTS=1, so a normal run does not rewrite tracked images.
test.describe.configure({ timeout: 120_000 });

const outDir = path.resolve(__dirname, '../../../docs/port/screens/chat');
const WORK = '33333333-3333-4333-8333-333333333333';

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_E2E_SHOW: '1' }, (dataRoot) => {
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
    });
  });
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

const bar = () => page.getByTestId('BarMeetingChat');
const chip = () => page.getByTestId('LblMeetingChatScope');

async function shot(name: string): Promise<void> {
  if (process.env.VOZELLA_SCREENSHOTS !== '1') return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

test('Record shows the bar collapsed with the All meetings chip', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
  await expect(chip()).toHaveText('All meetings');
  await expect(bar().getByRole('button', { name: /All meetings/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByTestId('BtnMeetingChatNew')).toBeVisible();
  await expect(page.getByTestId('BtnMeetingChatHistory')).toHaveCount(0);
  await shot('chat-bar-record-light');
});

test('Library with a folder shows the folder chip, and a meeting shows its title', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  await expect(chip()).toHaveText('All meetings');
  await page.getByRole('treeitem', { name: /Trabajo/ }).click();
  await expect(chip()).toHaveText('Folder: Trabajo');

  await page.getByRole('treeitem', { name: /Inbox/ }).first().click();
  await page
    .getByRole('grid', { name: 'Library' })
    .getByRole('row', { name: /Weekly planning/ })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Weekly planning' })).toBeVisible();
  await expect(chip()).toHaveText('Meeting: Weekly planning');
  await shot('chat-bar-meeting-light');
});

test('the header toggles with the keyboard and a scope change collapses it', async () => {
  const header = bar().getByRole('button', { name: /Meeting: Weekly planning/ });
  await header.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  // The expanded bar shows its composer, and the shot is taken with the composer focused.
  await expect(page.getByTestId('TxtMeetingChat')).toBeVisible();
  await page.getByTestId('TxtMeetingChat').focus();
  await shot('chat-bar-expanded-light');
  await header.focus();
  await page.keyboard.press('Space');
  await expect(header).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(chip()).toHaveText('All meetings');
  await expect(bar().getByRole('button', { name: /All meetings/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('Settings hides the bar completely', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(bar()).toBeHidden();
  await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
  await expect(bar()).toBeVisible();
});

test('dark theme screenshots', async () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  await page.evaluate(() => {
    window.localStorage.setItem('vozella.theme', 'dark');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(chip()).toHaveText('All meetings');
  await shot('chat-bar-record-dark');
  await bar()
    .getByRole('button', { name: /All meetings/ })
    .click();
  await expect(page.getByTestId('TxtMeetingChat')).toBeVisible();
  await page.getByTestId('TxtMeetingChat').focus();
  await shot('chat-bar-expanded-dark');
});
