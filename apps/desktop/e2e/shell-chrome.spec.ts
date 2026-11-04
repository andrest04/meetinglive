import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, seedReadySettings, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Shell chrome (sp-4): the startup migration notice, the rail, the call bar closing by itself,
// the shortcuts and their key caps, the chat dock wiring, and axe in both themes. The call is
// faked with VOZELLA_FAKE_CALL_FLAG (the watcher polls every 5 s). Screenshots land in
// docs/port/screens/shell-platform/ when VOZELLA_SCREENSHOTS=1.

const flagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-shell-chrome-flag-'));
const flag = path.join(flagDir, 'call.flag');
const outDir = path.resolve(__dirname, '../../../docs/port/screens/shell-platform');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const TICK_WAIT = 20_000;
const MEETING = 'b0000000-0000-4000-8000-000000000001';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp(
    { VOZELLA_FAKE_CALL_FLAG: flag, ...readyEnv, VOZELLA_E2E_SHOW: shots ? '1' : '0' },
    (dataRoot) => {
      seedReadySettings(dataRoot);
      // A damaged legacy meetings.json makes the startup migration fail with a message.
      fs.writeFileSync(path.join(dataRoot, 'app', 'meetings.json'), '{ not json', 'utf8');
      writeMeeting(path.join(dataRoot, 'meetings'), {
        id: MEETING,
        title: 'Weekly planning',
        recordedAt: '2026-09-03T10:30:00.0000000-05:00',
        summary: 'Agreed the scope for the September release.',
      });
    },
  );
  page = await launched.app.firstWindow();
  // The startup dialog is modal, so the rail is hidden from the accessibility tree until it closes.
  await expect(page.locator('#NavItemRecording')).toBeAttached();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 800);
  });
});

test.afterAll(async () => {
  fs.rmSync(flag, { force: true });
  fs.rmSync(flagDir, { recursive: true, force: true });
  await page.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
});

async function useTheme(value: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    window.localStorage.setItem('vozella.theme', next);
  }, value);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await page.evaluate(() => document.fonts.ready);
}

async function shot(name: string): Promise<void> {
  if (!shots) return;
  fs.mkdirSync(outDir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, name) });
}

async function seriousViolations(): Promise<{ id: string; nodes: string[] }[]> {
  await page.evaluate(axe.source);
  const results = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(document),
  );
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }));
}

test('a failed startup migration is told once, in a window dialog with the message (item 9, bug 7)', async () => {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Meeting history migration failed' }),
  ).toBeVisible();
  await expect(dialog).toContainText('Your original data was left untouched.');
  // The exception message is the detail line WinUI dropped.
  await expect(dialog).toContainText(/JSON/);
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeFocused();
  expect(await seriousViolations()).toEqual([]);
  await shot('startup-notice-light.png');

  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toHaveCount(0);

  // Once per launch: a reload of the window does not bring it back.
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The Library keeps its own notice.
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page.getByText(/could not be moved yet/).first()).toBeVisible();
});

test('the startup notice in dark', async () => {
  test.skip(!shots, 'set VOZELLA_SCREENSHOTS=1 to capture');
  await useTheme('dark');
  await page.evaluate(() => {
    window.sessionStorage.clear();
  });
  await page.reload();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await seriousViolations()).toEqual([]);
  await shot('startup-notice-dark.png');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await useTheme('light');
});

test('the rail has Record, Library and Settings with their automation ids (items 20, 21, 23)', async () => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Record', 'Library', 'Settings']);
  await expect(page.locator('#NavItemRecording')).toBeVisible();
  await expect(page.locator('#NavItemHistory')).toBeVisible();
  await expect(page.locator('#NavItemSettings')).toBeVisible();
  // First load selects Record.
  await page.evaluate(() => {
    window.location.hash = '';
  });
  await page.reload();
  await expect(page.locator('#NavItemRecording')).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/#\/record$/);
  // Title bar area: the mark and the name over the rail (item 14).
  await expect(page.locator('aside').getByText('Vozella', { exact: true })).toBeVisible();
});

test('the Settings label follows the app language, not the OS (item 21)', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'App language' }).click();
  await page.getByRole('option', { name: 'Español' }).click();
  await page.getByRole('button', { name: 'Más tarde' }).click();
  await expect(page.locator('#NavItemSettings')).toHaveText('Configuración');
  await expect(page.locator('#NavItemHistory')).toHaveText('Biblioteca');
  await page.getByRole('combobox', { name: 'Idioma de la aplicación' }).click();
  await page.getByRole('option', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.locator('#NavItemSettings')).toHaveText('Settings');
});

test('selecting navigates and publishes the tag; the same page is a no-op; Session keeps the rail on Library (items 24 to 27)', async () => {
  await page.locator('#NavItemHistory').click();
  await expect(page).toHaveURL(/#\/library$/);
  const state = () => page.evaluate(() => window.vozella.invoke('workspace.getState', {}));
  await expect.poll(async () => (await state()).currentShellTag).toBe('History');

  const before = await page.evaluate(() => window.history.length);
  await page.locator('#NavItemHistory').click();
  expect(await page.evaluate(() => window.history.length)).toBe(before);
  await expect(page).toHaveURL(/#\/library$/);

  await page.getByText('Weekly planning').first().click();
  await expect(page).toHaveURL(/#\/session$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Weekly planning' })).toBeVisible();
  await expect(page.locator('#NavItemHistory')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#NavItemRecording')).not.toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => (await state()).currentShellTag).toBe('Session');

  // Re-clicking Library on a session returns to the list.
  await page.locator('#NavItemHistory').click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible();
});

test('a navigation request from elsewhere moves the rail and the page together (item 28)', async () => {
  await page.evaluate(() => {
    window.location.hash = '#/record';
  });
  await expect(page.locator('#NavItemRecording')).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() =>
    window.vozella.invoke('workspace.dispatch', {
      action: { type: 'navigateTo', tag: 'Settings' },
    }),
  );
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.locator('#NavItemSettings')).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() =>
    window.vozella.invoke('workspace.dispatch', { action: { type: 'navigateTo', tag: 'History' } }),
  );
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.locator('#NavItemHistory')).toHaveAttribute('aria-current', 'page');
});

test('the call bar closes by itself when the call ends, and is offered again for the next call (bug 5, items 35 to 38)', async () => {
  await page.locator('#NavItemSettings').click();
  fs.writeFileSync(flag, '');
  const bar = page.locator('#InfoCallPrompt');
  await expect(bar).toBeVisible({ timeout: TICK_WAIT });
  await expect(bar.getByText('A call is happening')).toBeVisible();
  expect(await seriousViolations()).toEqual([]);
  await shot('call-bar-light.png');

  // Still up while the call goes on and across pages.
  await page.locator('#NavItemHistory').click();
  await page.waitForTimeout(1500);
  await expect(bar).toBeVisible();

  fs.rmSync(flag, { force: true });
  await expect(bar).toHaveCount(0, { timeout: TICK_WAIT });

  // Offered once per call: the next call shows it again, whatever the popup setting says.
  fs.writeFileSync(flag, '');
  await expect(bar).toBeVisible({ timeout: TICK_WAIT });
  await bar.getByRole('button', { name: 'Close' }).click();
  await expect(bar).toHaveCount(0);
  fs.rmSync(flag, { force: true });
  await page.waitForTimeout(5500);
});

test('the call bar closes when a recording starts (item 38)', async () => {
  await page.locator('#NavItemRecording').click();
  await installEngine(page);
  fs.writeFileSync(flag, '');
  const bar = page.locator('#InfoCallPrompt');
  await expect(bar).toBeVisible({ timeout: TICK_WAIT });

  await page.keyboard.press('Control+r');
  await expect(page.getByTestId('recording-bar')).toBeVisible({ timeout: 30_000 });
  await expect(bar).toHaveCount(0);
});

test('Ctrl+P pauses, Ctrl+R stops, and the tooltips show key caps (items 138, 139)', async () => {
  await expect(page.getByTestId('recording-bar')).toBeVisible();
  const caps = async (button: string): Promise<string[]> => {
    await page.getByRole('button', { name: button }).hover();
    const first = page.locator('kbd').first();
    await expect(first).toBeVisible();
    return page.locator('kbd').allTextContents();
  };
  expect(await caps('Pause')).toEqual(['Ctrl', 'P']);
  await page.mouse.move(0, 0);

  await page.keyboard.press('Control+p');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  // Ctrl+Enter in the live ask box asks; the chat composer does not see it.
  const ask = page.getByTestId('TxtLiveAsk');
  const chatRows = page.getByTestId('ListMeetingChat').getByRole('listitem');
  await ask.fill('What did we decide?');
  const chatBefore = await chatRows.count();
  await ask.press('Control+Enter');
  await expect(ask).toBeFocused();
  expect(await chatRows.count()).toBe(chatBefore);

  await page.keyboard.press('Control+r');
  await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 60_000 });
  fs.rmSync(flag, { force: true });
});

test('the chat dock expands and its Send tooltip names Enter and Ctrl+Enter (items 116, 123, bug 23)', async () => {
  await page.locator('#NavItemHistory').click();
  const header = page.getByRole('button').filter({ has: page.getByTestId('LblMeetingChatScope') });
  await expect(header).toBeVisible();
  await header.click();
  const composer = page.getByTestId('TxtMeetingChat');
  await expect(composer).toBeVisible();
  // Enter on an empty draft adds no line; Shift+Enter does.
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await composer.fill('hello');
  await composer.press('Shift+Enter');
  await expect(composer).toHaveValue('hello\n');
  await composer.fill('hello');
  await page.getByTestId('BtnMeetingChatSend').hover();
  await expect(page.locator('kbd')).toHaveText(['Enter', 'Ctrl', 'Enter']);
  await shot('chat-dock-light.png');
  await composer.fill('');
  await header.click();
});

for (const theme of ['light', 'dark'] as const) {
  test(`Record, Library and Settings have no serious accessibility violations in ${theme}`, async () => {
    await useTheme(theme);
    for (const [id, name] of [
      ['#NavItemRecording', 'record'],
      ['#NavItemHistory', 'library'],
      ['#NavItemSettings', 'settings'],
    ] as const) {
      await page.locator(id).click();
      await page.waitForTimeout(300);
      expect(await seriousViolations(), `${name} in ${theme}`).toEqual([]);
      await shot(`${name}-${theme}.png`);
    }
  });
}

test('keyboard focus draws the 2 px ink ring with a 2 px offset (item 164)', async () => {
  await useTheme('light');
  await page.locator('#NavItemSettings').click();
  // Tab to the first link: the focus ring is an outline of 2 px with a 2 px offset.
  await page.locator('#NavItemRecording').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  // Chromium snaps outline widths to whole device pixels: 2 px is 1.6 px at a 125 percent scale.
  // Links fade their colors for 150 ms, so the ring color is polled until it settles on ink.
  await expect
    .poll(() =>
      page.locator('#NavItemRecording').evaluate((el) => {
        const style = getComputedStyle(el);
        const snap = (px: number): string =>
          `${String(Math.floor(px * devicePixelRatio) / devicePixelRatio)}px`;
        const ink = getComputedStyle(document.documentElement).color;
        return {
          width: style.outlineWidth === snap(2),
          offset: style.outlineOffset === snap(2),
          style: style.outlineStyle,
          ink: style.outlineColor === ink,
        };
      }),
    )
    .toEqual({ width: true, offset: true, style: 'solid', ink: true });
});
