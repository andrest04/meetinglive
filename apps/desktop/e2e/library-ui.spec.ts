import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Main flows of the Library screen and the Settings data card, in the real app with fake native
// adapters and a throwaway data root. Files are written the way the app writes them.

// Hidden windows throttle animation frames, so every action waits longer than in a shown one.
test.describe.configure({ timeout: 150_000 });

let launched: LaunchedApp;
let page: Page;
let libraryRoot: string;

const ID_A = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const ID_B = '4a2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0e';
const ID_C = '5b2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0f';

test.beforeAll(async () => {
  launched = await launchApp();
  libraryRoot = path.join(launched.dataRoot, 'meetings');
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  // Never open a real file manager from a test.
  await launched.app.evaluate(({ shell }) => {
    shell.openPath = () => Promise.resolve('');
  });
});

test.afterAll(async () => {
  await launched.close();
});

const goTo = async (name: 'Library' | 'Settings' | 'Record'): Promise<void> => {
  await page.getByRole('navigation').getByRole('link', { name }).click();
};

test('an empty library points at recording, and the shell follows the request', async () => {
  await goTo('Library');
  await expect(page.getByText('No meetings recorded yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Record a meeting' }).click();
  await expect(page).toHaveURL(/#\/record$/);
});

test('browse, search, open a meeting and its summary', async () => {
  writeMeeting(libraryRoot, {
    id: ID_A,
    title: 'Standup',
    recordedAt: '2026-09-01T09:00:00.0000000+00:00',
    summary: '## Plan\nShip the release on Friday',
  });
  writeMeeting(libraryRoot, {
    id: ID_B,
    title: 'Planning',
    recordedAt: '2026-09-03T09:00:00.0000000+00:00',
    transcript: 'Hola a todos',
  });
  await goTo('Settings');
  await goTo('Library');
  await page.getByRole('treeitem', { name: /Inbox/ }).click();

  const list = page.getByRole('grid', { name: 'Library' });
  const rows = list.locator('[data-row-id]');
  await expect(rows).toHaveCount(2);
  // Newest first, each with a snippet.
  await expect(rows.first()).toContainText('Planning');
  await expect(rows.first()).toContainText('Hola a todos');
  await expect(rows.nth(1)).toContainText('Ship the release on Friday');

  await page.getByRole('searchbox').fill('stand');
  await expect(rows).toHaveCount(1);
  await page.getByRole('searchbox').fill('nothing here');
  await expect(page.getByText('No meetings match your search.')).toBeVisible();
  await page.getByRole('searchbox').fill('');

  await list.getByRole('row', { name: /Standup/ }).click();
  await expect(page).toHaveURL(/#\/session$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Standup' })).toBeVisible();

  await page.getByRole('button', { name: 'Back' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Planning' });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Open summary' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Planning' })).toBeVisible();
  const state = await page.evaluate(() => window.vozella.invoke('workspace.getState', {}));
  expect(state).toMatchObject({
    selectedMeetingId: ID_B,
    sessionTab: 'Summary',
    currentShellTag: 'Session',
  });
});

test('folders: create, note, move a meeting into it, rename, restyle, keep a full one', async () => {
  await goTo('Library');
  await page.getByRole('button', { name: 'New folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Universidad');
  await dialog.getByRole('textbox', { name: 'Name' }).press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('treeitem', { name: /Universidad/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(fs.existsSync(path.join(libraryRoot, 'Universidad'))).toBe(true);
  await expect(page.getByText('This folder is empty.')).toBeVisible();

  // A child folder is created inside the selected one; a repeated name is refused in place.
  await page.getByRole('button', { name: 'New folder' }).click();
  const child = page.getByRole('dialog', { name: 'New folder in Universidad' });
  await child.getByRole('textbox', { name: 'Name' }).fill('Calculo');
  await child.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('treeitem', { name: /Calculo/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('treeitem', { name: /^Universidad/ }).click();
  await page.getByRole('button', { name: 'New folder' }).click();
  const dup = page.getByRole('dialog', { name: 'New folder in Universidad' });
  await dup.getByRole('textbox', { name: 'Name' }).fill('calculo');
  await dup.getByRole('button', { name: 'Create' }).click();
  await expect(dup.getByText('A folder with this name already exists here.')).toBeVisible();
  await dup.getByRole('button', { name: 'Cancel' }).click();
  await expect(dup).toBeHidden();

  // The folder note is saved when the selection changes.
  await page.getByRole('textbox', { name: 'Folder notes' }).fill('  Fall term  ');
  await page.getByRole('treeitem', { name: /Inbox/ }).click();
  await expect
    .poll(() => fs.readFileSync(path.join(libraryRoot, 'folders.json'), 'utf8'))
    .toContain('"note": "Fall term"');

  // Move Planning into Calculo: the files move on disk.
  const row = page.getByRole('row').filter({ hasText: 'Planning' });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move' }).click();
  const move = page.getByRole('dialog', { name: 'Move meeting' });
  await expect(move.getByRole('radio').first()).toBeChecked();
  await move.getByText('Universidad / Calculo').click();
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Planning' })).toHaveCount(0);
  const moved = path.join(libraryRoot, 'Universidad', 'Calculo', '2026-09-03 Planning.md');
  await expect.poll(() => fs.existsSync(moved)).toBe(true);
  expect(fs.existsSync(path.join(libraryRoot, 'Inbox', '2026-09-03 Planning.md'))).toBe(false);

  // Rename from the context menu: the directory follows.
  await page.getByRole('treeitem', { name: /^Universidad/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename folder' });
  await rename.getByRole('textbox', { name: 'Name' }).fill('Estudios');
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('treeitem', { name: /Estudios/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect
    .poll(() =>
      fs.existsSync(path.join(libraryRoot, 'Estudios', 'Calculo', '2026-09-03 Planning.md')),
    )
    .toBe(true);

  // Personality.
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Personality' }).click();
  const look = page.getByRole('dialog', { name: 'Folder personality' });
  await look.getByRole('radio', { name: 'purple' }).click();
  await look.getByRole('radio', { name: 'book' }).click();
  await look.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(() => fs.readFileSync(path.join(libraryRoot, 'folders.json'), 'utf8'))
    .toMatch(/"colorKey": "purple"[\s\S]*"iconKey": "book"/);

  // A folder with contents cannot be deleted.
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete folder' }).click();
  await expect(
    page.getByText('This folder still has subfolders or meetings. Empty it before deleting.'),
  ).toBeVisible();
});

test('an empty folder is deleted after confirming', async () => {
  await goTo('Library');
  await page.getByRole('treeitem', { name: /Inbox/ }).click();
  await page.getByRole('button', { name: 'New folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Temporal');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('treeitem', { name: /Temporal/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Folder actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete folder' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this folder?' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('treeitem', { name: /Temporal/ })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /Inbox/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(fs.existsSync(path.join(libraryRoot, 'Temporal'))).toBe(false);
});

test('a meeting is deleted only after confirming, with Cancel focused', async () => {
  writeMeeting(libraryRoot, {
    id: ID_C,
    title: 'Retro',
    recordedAt: '2026-09-04T09:00:00.0000000+00:00',
  });
  await goTo('Settings');
  await goTo('Library');
  await page.getByRole('treeitem', { name: /Inbox/ }).click();
  const row = page.getByRole('row').filter({ hasText: 'Retro' });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this meeting?' });
  await expect(
    confirm.getByText('This moves "Retro" and its recording to the Recycle Bin.'),
  ).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Retro' })).toHaveCount(0);
  expect(fs.existsSync(path.join(libraryRoot, 'Inbox', '2026-09-04 Retro.md'))).toBe(false);
});

test('Settings shows where data lives, follows a picked folder, and refuses MeetingLive here', async () => {
  await goTo('Settings');
  await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible();
  await expect(page.getByText(libraryRoot, { exact: true })).toBeVisible();
  await expect(page.getByText(path.join(launched.dataRoot, 'app'), { exact: true })).toBeVisible();

  // Open folder asks the shell, which is stubbed above, and reports nothing wrong.
  await page.getByRole('button', { name: 'Open folder' }).click();
  await expect(page.getByText(/could not be opened/)).toHaveCount(0);

  const picked = path.join(launched.dataRoot, 'picked');
  fs.mkdirSync(picked);
  writeMeeting(picked, {
    id: '6c2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c10',
    title: 'Elsewhere',
    recordedAt: '2026-09-05T09:00:00.0000000+00:00',
  });
  await launched.app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, picked);
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(page.getByText(picked, { exact: true })).toBeVisible();
  await goTo('Library');
  await expect(page.getByRole('row').filter({ hasText: 'Elsewhere' })).toBeVisible();

  const forbidden = path.join(launched.dataRoot, 'x', 'MeetingLive');
  fs.mkdirSync(forbidden, { recursive: true });
  await launched.app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [target] });
  }, forbidden);
  await goTo('Settings');
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(page.getByText(/That folder cannot be used/)).toBeVisible();
  await expect(page.getByText(picked, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Use the default folder' }).click();
  await expect(page.getByText(libraryRoot, { exact: true })).toBeVisible();
});

test('the library is panes that scroll on their own, under the title bar and over the chat', async () => {
  const resize = async (width: number, height: number): Promise<void> => {
    await launched.app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      },
      { width, height },
    );
  };
  const before = await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getContentSize(),
  );
  await goTo('Library');
  const main = page.locator('#content');
  await expect.poll(() => main.evaluate((el) => getComputedStyle(el).overflowY)).toBe('hidden');

  await resize(1180, 760);
  const preview = page.getByTestId('library-preview');
  await expect(preview).toBeVisible();
  // clamp(340px, 38%, 440px) of the 948 px beside the 232 px sidebar.
  const list = page.getByTestId('library-list-pane');
  await expect.poll(async () => (await list.boundingBox())?.width).toBeCloseTo(360.24, 0);
  // The chat bar sits under the panes, not over them.
  const paneBottom = (await list.boundingBox())?.y ?? 0;
  const mainBox = await main.boundingBox();
  expect(paneBottom).toBeGreaterThanOrEqual(mainBox?.y ?? Infinity);

  // Below 760 px of content there is no preview. The window minimum leaves 728 px.
  await resize(960, 700);
  await expect(preview).toHaveCount(0);

  await goTo('Settings');
  await expect.poll(() => main.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  if (before?.[0] && before[1]) await resize(before[0], before[1]);
});

test('no serious accessibility violations on the library, its dialogs and the data card', async () => {
  const check = async (): Promise<void> => {
    // AxeBuilder opens a second page, which Electron does not support: inject axe directly.
    await page.evaluate(axe.source);
    const results = await page.evaluate(() =>
      (window as unknown as { axe: typeof axe }).axe.run(document),
    );
    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
      serious.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
      })),
    ).toEqual([]);
  };
  writeMeeting(path.join(launched.dataRoot, 'meetings'), {
    id: '7d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c11',
    title: 'Accessibility check',
    recordedAt: '2026-09-06T09:00:00.0000000+00:00',
    summary: 'A short summary',
  });
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await goTo('Library');
    await expect(page.getByRole('grid', { name: 'Library' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await check();

    await page.getByRole('button', { name: 'New folder' }).click();
    await expect(page.getByRole('dialog', { name: 'New folder' })).toBeVisible();
    await check();
    await page.keyboard.press('Escape');

    await goTo('Settings');
    await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible();
    await check();
  }
});
