import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// AI panel in the shell (chat-6): launcher, docked and floating panel, Ctrl+J, persistence. Screenshots land in docs/port/screens/chat/ when
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

const panel = () => page.getByTestId('BarMeetingChat');
const chip = () => page.getByTestId('LblMeetingChatScope');
const launcher = () => page.getByRole('button', { name: 'Ask AI' });
const composer = () => page.getByTestId('TxtMeetingChat');

async function resize(width: number, height: number): Promise<void> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
}

async function shot(name: string): Promise<void> {
  if (process.env.VOZELLA_SCREENSHOTS !== '1') return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

test('Record shows the launcher and a closed panel with the All meetings scope', async () => {
  await resize(1280, 800);
  await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
  await expect(launcher()).toBeVisible();
  await expect(launcher()).toHaveAttribute('aria-expanded', 'false');
  await expect(panel()).toBeHidden();
  await expect(chip()).toHaveText('All meetings');
  await expect(page.getByTestId('BtnMeetingChatHistory')).toHaveCount(0);
  await shot('chat-panel-launcher-light');
});

test('the launcher opens a docked panel beside the page, focused on the composer', async () => {
  await launcher().click();
  await expect(composer()).toBeFocused();
  await expect(launcher()).toHaveCount(0);
  await expect(panel()).toHaveAttribute('data-mode', 'dock');
  const content = await page.locator('#content').boundingBox();
  const box = await panel().boundingBox();
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  expect(box?.width).toBeCloseTo(380, 0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeCloseTo(viewport.width, 0);
  expect((content?.x ?? 0) + (content?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + 0.5);
  // The composer sits at the bottom of the panel.
  const field = await composer().boundingBox();
  expect(
    (box?.y ?? 0) + (box?.height ?? 0) - ((field?.y ?? 0) + (field?.height ?? 0)),
  ).toBeLessThan(32);
  await expect(page.getByTestId('BtnMeetingChatNew')).toBeVisible();
  await shot('chat-panel-docked-light');
});

test('the handle resizes the panel within 320 to 520 and a double click restores 380', async () => {
  const handle = page.getByRole('separator', { name: 'Resize AI panel' });
  await handle.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '444');
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '320');
  await expect.poll(async () => (await panel().boundingBox())?.width).toBeCloseTo(320, 0);
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '380');
});

test('the panel stays open across pages and its scope follows the view', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  await expect(chip()).toHaveText('All meetings');
  await page.getByRole('treeitem', { name: /Trabajo/ }).click();
  await expect(chip()).toHaveText('Folder: Trabajo');
  await expect(panel()).toBeVisible();

  await page.getByRole('treeitem', { name: /Inbox/ }).first().click();
  await page
    .getByRole('grid', { name: 'Library' })
    .getByRole('row', { name: /Weekly planning/ })
    .dblclick();
  await expect(page.getByRole('heading', { level: 1, name: 'Weekly planning' })).toBeVisible();
  await expect(chip()).toHaveText('Meeting: Weekly planning');
  await expect(panel()).toBeVisible();
  await shot('chat-panel-meeting-light');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(chip()).toHaveText('All meetings');
  await expect(panel()).toBeVisible();
});

test('Ctrl+J closes and reopens the panel, and focus goes back to the launcher', async () => {
  await composer().focus();
  await page.keyboard.press('Control+j');
  await expect(panel()).toBeHidden();
  await expect(launcher()).toBeFocused();
  await page.keyboard.press('Control+Shift+J');
  await expect(composer()).toBeFocused();
});

test('Settings hides the panel and the launcher, and the panel comes back open', async () => {
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(panel()).toBeHidden();
  await expect(launcher()).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
  await expect(panel()).toBeVisible();
});

test('on a narrow window the panel floats over the page and Escape closes it', async () => {
  // The window minimum leaves 728 px beside the sidebar: less than 560 plus the panel.
  await resize(960, 700);
  await expect(panel()).toHaveAttribute('data-mode', 'overlay');
  await expect(page.getByRole('separator', { name: 'Resize AI panel' })).toHaveCount(0);
  const content = await page.locator('#content').boundingBox();
  expect(content?.width).toBeGreaterThan(700);
  await shot('chat-panel-overlay-light');
  await composer().focus();
  await page.keyboard.press('Escape');
  await expect(panel()).toBeHidden();
  await expect(launcher()).toBeFocused();

  await launcher().click();
  await expect(panel()).toBeVisible();
  // A click on the page closes the floating panel.
  await page.locator('#content').click({ position: { x: 40, y: 200 } });
  await expect(panel()).toBeHidden();
  await resize(1280, 800);
});

test('the open state and width survive a reload', async () => {
  await launcher().click();
  const handle = page.getByRole('separator', { name: 'Resize AI panel' });
  await handle.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '336');
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(panel()).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize AI panel' })).toHaveAttribute(
    'aria-valuenow',
    '336',
  );
});

test('dark theme screenshots', async () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  await page.evaluate(() => {
    window.localStorage.setItem('vozella.theme', 'dark');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(composer()).toBeVisible();
  await composer().focus();
  await shot('chat-panel-docked-dark');
  await page.getByRole('button', { name: 'Close AI panel' }).click();
  await shot('chat-panel-launcher-dark');
});
