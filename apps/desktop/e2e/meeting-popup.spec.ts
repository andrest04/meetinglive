import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// The floating call popup in the real app on the fake native build. No real call window exists:
// the test-only VOZELLA_FAKE_CALL_FLAG makes the scanner report a call while a flag file exists.
// The watcher polls every 5 s, so the waits below are generous.

const flagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-call-flag-'));
const flag = path.join(flagDir, 'call.flag');
const outDir = path.resolve(__dirname, '../../../docs/port/screens/calendar-detection');
const TICK_WAIT = 20_000;

let launched: LaunchedApp;
let main: Page;

test.describe.configure({ mode: 'serial', timeout: 90_000 });

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_FAKE_CALL_FLAG: flag });
  main = await launched.app.firstWindow();
  await expect(main.getByRole('navigation')).toBeVisible();
  await main.evaluate(() => {
    const probe = window as unknown as { took: number };
    probe.took = 0;
    window.vozella.on('workspace.takeNotesRequested', () => {
      probe.took += 1;
    });
  });
});

test.afterAll(async () => {
  fs.rmSync(flagDir, { recursive: true, force: true });
  await launched.close();
});

function popupPages(): Page[] {
  return launched.app.windows().filter((page) => page.url().includes('meeting-prompt.html'));
}

async function popupPage(): Promise<Page> {
  await expect.poll(() => popupPages().length, { timeout: TICK_WAIT }).toBeGreaterThan(0);
  const page = popupPages()[0];
  if (!page) throw new Error('no popup page');
  await expect(page.locator('#TxtMeetingPromptTitle')).toBeVisible();
  return page;
}

interface PopupState {
  readonly visible: boolean;
  readonly focused: boolean;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly workArea: { x: number; y: number; width: number; height: number };
}

async function popupState(): Promise<PopupState | null> {
  return await launched.app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('meeting-prompt.html'),
    );
    if (!win || win.isDestroyed()) return null;
    return {
      visible: win.isVisible(),
      focused: win.isFocused(),
      bounds: win.getBounds(),
      workArea: screen.getDisplayMatching(win.getBounds()).workArea,
    };
  });
}

/** Ends the call and waits for the popup window to go away, so the next call can be offered. */
async function endCall(): Promise<void> {
  fs.rmSync(flag, { force: true });
  await expect
    .poll(async () => (await popupState())?.visible ?? false, { timeout: TICK_WAIT })
    .toBe(false);
  // One more tick so the watcher sees the empty scan and re-arms.
  await main.waitForTimeout(5500);
}

function startCall(): void {
  fs.writeFileSync(flag, '');
}

async function settingEnabled(): Promise<boolean> {
  return await main.evaluate(
    async () => (await window.vozella.invoke('settings.get', {})).meetingPopupEnabled,
  );
}

test('the popup appears top right without taking focus', async () => {
  startCall();
  const page = await popupPage();
  // The very first popup of a session is visible too, not only the ones after it.
  await expect(page.locator('.popup-card')).toHaveCSS('opacity', '1');
  await expect(page.locator('#TxtMeetingPromptTitle')).toHaveText('Meeting detected');
  await expect(page.locator('#TxtMeetingPromptSubtitle')).toHaveText('Take notes with Vozella');
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More options' })).toBeVisible();

  const state = await popupState();
  expect(state).not.toBeNull();
  if (!state) return;
  expect(state.visible).toBe(true);
  expect(state.focused).toBe(false);
  expect(state.bounds.width).toBe(480);
  expect(state.bounds.height).toBe(72);
  expect(state.bounds.x + state.bounds.width).toBe(state.workArea.x + state.workArea.width - 24);
  expect(state.bounds.y).toBe(state.workArea.y + 24);
  // The window is transparent and the page stays dark whatever the app theme is.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the card stays dark when the app theme is light', async () => {
  await launched.app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'light';
  });
  const page = await popupPage();
  const background = await page
    .locator('.popup-card')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).toBe('rgb(23, 23, 23)');
  await launched.app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'system';
  });
});

test('Dismiss from the More menu closes the popup', async () => {
  const page = await popupPage();
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: 'Dismiss' }).click();
  await expect.poll(async () => (await popupState())?.visible ?? false).toBe(false);
  expect(await settingEnabled()).toBe(true);
  await endCall();
});

test('Start requests take notes and brings the main window to the front', async () => {
  startCall();
  const page = await popupPage();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect.poll(async () => (await popupState())?.visible ?? false).toBe(false);
  await expect
    .poll(async () => await main.evaluate(() => (window as unknown as { took: number }).took))
    .toBe(1);
  const mainState = await launched.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('index.html'),
    );
    return { visible: win?.isVisible() ?? false, minimized: win?.isMinimized() ?? true };
  });
  expect(mainState).toEqual({ visible: true, minimized: false });
  await endCall();
});

test('no popup shows while a take is recording', async () => {
  await main.getByRole('link', { name: 'Record' }).click();
  // The previous test's Start request auto-starts a take; end it so this one begins idle.
  const stop = main.getByRole('button', { name: 'Stop' });
  if (await stop.isVisible()) {
    await stop.click();
    await expect(main.getByRole('button', { name: 'Record' })).toBeEnabled();
  }
  await expect(main.getByRole('heading', { level: 2, name: 'Sources' })).toBeVisible();
  await main.getByRole('button', { name: 'Record' }).click();
  await expect(main.getByTestId('recording-status')).toContainText('Recording');

  startCall();
  // Two full ticks: a popup would have been raised on the first one.
  await main.waitForTimeout(11_000);
  expect(popupPages().length === 0 || !((await popupState())?.visible ?? false)).toBe(true);

  await main.getByRole('button', { name: 'Stop' }).click();
  await expect(main.getByRole('button', { name: 'Record' })).toBeEnabled();
  await endCall();
});

test('Do not notify me again turns the setting off and keeps it off', async () => {
  startCall();
  const page = await popupPage();
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: "Don't notify me again" }).click();
  await expect.poll(settingEnabled).toBe(false);
  await expect.poll(async () => (await popupState())?.visible ?? false).toBe(false);
  await endCall();

  // With the setting off a new call raises no popup.
  startCall();
  await main.waitForTimeout(11_000);
  expect((await popupState())?.visible ?? false).toBe(false);
  fs.rmSync(flag, { force: true });
});

const shots = process.env.VOZELLA_SCREENSHOTS === '1';

test.describe('screenshots', () => {
  test.skip(!shots, 'set VOZELLA_SCREENSHOTS=1 to capture');

  for (const theme of ['light', 'dark'] as const) {
    test(`popup with the app in ${theme}`, async () => {
      await main.evaluate(async () => {
        await window.vozella.invoke('settings.update', { patch: { meetingPopupEnabled: true } });
      });
      await launched.app.evaluate(({ nativeTheme }, value) => {
        nativeTheme.themeSource = value;
      }, theme);
      await main.waitForTimeout(5500);
      startCall();
      const page = await popupPage();
      await page.evaluate((value) => document.fonts.ready.then(() => value), theme);
      // A desktop colour behind the card, so the rounded corners and the stroke can be judged.
      await page.evaluate(
        (color) => {
          document.documentElement.style.setProperty('background', color, 'important');
        },
        theme === 'light' ? '#e9e8e4' : '#2a2a2a',
      );
      await expect(page.locator('.popup-card')).toHaveCSS('opacity', '1');
      await page.waitForTimeout(800);
      fs.mkdirSync(outDir, { recursive: true });
      await page.screenshot({ path: path.join(outDir, `popup-${theme}.png`) });

      await page.getByRole('button', { name: 'More options' }).click();
      await expect(page.getByRole('menuitem', { name: 'Dismiss' })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(outDir, `popup-menu-${theme}.png`) });
      await page.keyboard.press('Escape');
      await endCall();
    });
  }
});
