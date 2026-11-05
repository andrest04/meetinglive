import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Checking, keyboard and drag in the real renderer, with files on disk behind them. Each test seeds
// its own meetings and refreshes by leaving the route, so the order of the tests does not matter.

test.describe.configure({ timeout: 150_000 });

let launched: LaunchedApp;
let page: Page;
let libraryRoot: string;
let grid: Locator;

const FOLDER = 'aaaaaaaa-0000-4000-8000-000000000001';
let nextId = 1;

function seed(title: string, day: string): void {
  const id = `bbbbbbbb-0000-4000-8000-${String((nextId += 1)).padStart(12, '0')}`;
  writeMeeting(libraryRoot, { id, title, recordedAt: `2026-09-${day}T09:00:00.0000000+00:00` });
}

const row = (name: string): Locator => grid.getByRole('row', { name: new RegExp(name) });

const onDisk = (folder: string, title: string, day: string): string =>
  path.join(libraryRoot, folder, `2026-09-${day} ${title}.md`);

async function reopenLibrary(): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  await page.getByRole('treeitem', { name: /Inbox/ }).click();
  await expect(grid).toBeVisible();
}

test.beforeAll(async () => {
  launched = await launchApp({}, (dataRoot) => {
    const root = path.join(dataRoot, 'meetings');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'folders.json'),
      JSON.stringify([
        {
          id: FOLDER,
          name: 'Clients',
          parentId: null,
          note: null,
          colorKey: 'teal',
          iconKey: 'folder',
          createdAt: '2026-09-01T12:00:00+00:00',
        },
      ]),
    );
  });
  libraryRoot = path.join(launched.dataRoot, 'meetings');
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 760);
  });
  grid = page.getByRole('grid', { name: 'Library' });
});

test.afterAll(async () => {
  await launched.close();
});

test('checked meetings move and go to the bin together, and the files follow', async () => {
  seed('Bulk one', '11');
  seed('Bulk two', '10');
  seed('Bulk three', '09');
  await reopenLibrary();

  const bar = page.getByRole('toolbar', { name: 'Checked meetings' });
  await expect(bar).toHaveCount(0);
  await row('Bulk one').getByRole('checkbox').click();
  await page.keyboard.down('Shift');
  await row('Bulk two').click();
  await page.keyboard.up('Shift');
  await expect(bar.getByText('Checked: 2')).toBeVisible();
  await expect(row('Bulk one')).toHaveAttribute('aria-selected', 'true');
  await expect(row('Bulk two')).toHaveAttribute('aria-selected', 'true');
  await expect(row('Bulk three')).toHaveAttribute('aria-selected', 'false');

  // The bar and the visible checks are new surfaces for the contrast rules.
  await page.evaluate(axe.source);
  const results = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(document),
  );
  expect(
    results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
      })),
  ).toEqual([]);

  await bar.getByRole('button', { name: 'Move' }).click();
  const move = page.getByRole('dialog', { name: 'Move 2 meetings' });
  await move.getByText('Clients').click();
  await move.getByRole('button', { name: 'Move' }).click();
  await expect(bar).toHaveCount(0);
  await expect.poll(() => fs.existsSync(onDisk('Clients', 'Bulk one', '11'))).toBe(true);
  expect(fs.existsSync(onDisk('Clients', 'Bulk two', '10'))).toBe(true);
  expect(fs.existsSync(onDisk('Inbox', 'Bulk one', '11'))).toBe(false);
  await expect(row('Bulk one')).toHaveCount(0);

  await page.getByRole('treeitem', { name: /Clients/ }).click();
  await row('Bulk one').getByRole('checkbox').click();
  await row('Bulk two').getByRole('checkbox').click();
  await bar.getByRole('button', { name: 'Delete' }).click();
  const remove = page.getByRole('dialog', { name: 'Delete 2 meetings?' });
  await expect(remove.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await remove.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => fs.existsSync(onDisk('Clients', 'Bulk one', '11'))).toBe(false);
  expect(fs.existsSync(onDisk('Clients', 'Bulk two', '10'))).toBe(false);
  await expect(bar).toHaveCount(0);
});

test('the keyboard reaches everything: find, move, check, rename, delete', async () => {
  seed('Keys alpha', '21');
  seed('Keys beta', '20');
  seed('Keys gamma', '19');
  await reopenLibrary();

  // Ctrl+F, then down into the list, which previews without opening.
  await row('Keys alpha').focus();
  await page.keyboard.press('Control+f');
  const search = page.getByRole('searchbox');
  await expect(search).toBeFocused();
  await page.keyboard.type('keys');
  await expect(grid.locator('[data-row-id]')).toHaveCount(3);
  await page.keyboard.press('ArrowDown');
  await expect(row('Keys alpha')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row('Keys beta')).toBeFocused();
  const preview = page.getByTestId('library-preview');
  await expect(preview.getByRole('heading', { level: 2, name: 'Keys beta' })).toBeVisible();
  await expect(page).toHaveURL(/#\/library$/);

  // Checks by Space, Shift and Ctrl+A, and Escape takes them back, then the search.
  const bar = page.getByRole('toolbar', { name: 'Checked meetings' });
  await page.keyboard.press('Space');
  await expect(bar.getByText('Checked: 1')).toBeVisible();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(bar.getByText('Checked: 2')).toBeVisible();
  await page.keyboard.press('Control+a');
  await expect(bar.getByText('Checked: 3')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(search).toHaveValue('keys');
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');

  // F2 renames on disk, and the list follows.
  await row('Keys gamma').focus();
  await page.keyboard.press('F2');
  const rename = page.getByRole('dialog', { name: 'Rename meeting' });
  await rename.getByRole('textbox').fill('Keys delta');
  await page.keyboard.press('Enter');
  await expect(rename).toBeHidden();
  await expect(row('Keys delta')).toBeVisible();
  await expect.poll(() => fs.existsSync(onDisk('Inbox', 'Keys delta', '19'))).toBe(true);

  // Delete asks, then the next row has the focus; Shift+Delete asks with permanent words.
  await row('Keys alpha').focus();
  await page.keyboard.press('Delete');
  const remove = page.getByRole('dialog', { name: 'Delete this meeting?' });
  await remove.getByRole('button', { name: 'Delete' }).click();
  await expect(row('Keys alpha')).toHaveCount(0);
  await expect(row('Keys beta')).toBeFocused();
  expect(fs.existsSync(onDisk('Inbox', 'Keys alpha', '21'))).toBe(false);

  await page.keyboard.press('Shift+Delete');
  const permanent = page.getByRole('dialog', { name: 'Delete permanently?' });
  await expect(permanent.getByText(/cannot be undone/)).toBeVisible();
  await permanent.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(row('Keys beta')).toHaveCount(0);
  expect(fs.existsSync(onDisk('Inbox', 'Keys beta', '20'))).toBe(false);

  // Enter opens what the cursor is on.
  await row('Keys delta').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/session$/);
  await page.getByRole('button', { name: 'Back' }).click();
});

test('a meeting dragged to a folder moves on disk, and Undo brings it back', async () => {
  seed('Drag one', '29');
  seed('Drag two', '28');
  await reopenLibrary();
  const clients = page.getByRole('treeitem', { name: /Clients/ });

  await row('Drag one').dragTo(clients);
  await expect.poll(() => fs.existsSync(onDisk('Clients', 'Drag one', '29'))).toBe(true);
  await expect(row('Drag one')).toHaveCount(0);
  await expect(page.getByText('Moved "Drag one" to Clients.')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => fs.existsSync(onDisk('Inbox', 'Drag one', '29'))).toBe(true);
  await expect(row('Drag one')).toBeVisible();
});

test('with forced colors, what is selected keeps its text on the canvas, inside an outline', async () => {
  seed('Forced one', '18');
  await reopenLibrary();
  await row('Forced one').click();
  await page.emulateMedia({ forcedColors: 'active' });
  try {
    const look = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          const probe = document.createElement('div');
          probe.style.backgroundColor = 'Highlight';
          document.body.append(probe);
          const highlight = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            filled: style.backgroundColor === highlight,
            outlined: style.outlineStyle !== 'none' && style.outlineColor === highlight,
          };
        });
    // Chromium draws a Canvas backplate behind text, so light text on a Highlight fill disappears.
    for (const selector of ['[role="treeitem"][aria-selected="true"]', '[data-cursor="true"]']) {
      await expect.poll(() => look(selector)).toEqual({ filled: false, outlined: true });
    }
    await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
    await expect
      .poll(() => look('a[aria-current="page"]'))
      .toEqual({ filled: false, outlined: true });
    await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  } finally {
    await page.emulateMedia({ forcedColors: 'none' });
  }
});
