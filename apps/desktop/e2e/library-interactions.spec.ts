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
