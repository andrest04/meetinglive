import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Axe over the grid and the tree, in every state that changes their roles or their colors. Rows use
// colors on tinted fills, so contrast is checked with hover, cursor, checks and marks all showing.

test.describe.configure({ timeout: 150_000 });

let launched: LaunchedApp;
let page: Page;

const FOLDER = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHILD = 'aaaaaaaa-0000-4000-8000-000000000002';

function seedLibrary(dataRoot: string): void {
  const root = path.join(dataRoot, 'meetings');
  fs.mkdirSync(path.join(root, 'Clients', 'Acme'), { recursive: true });
  const folder = (id: string, name: string, parentId: string | null) => ({
    id,
    name,
    parentId,
    note: null,
    colorKey: 'teal',
    iconKey: 'folder',
    createdAt: '2026-09-01T12:00:00+00:00',
  });
  fs.writeFileSync(
    path.join(root, 'folders.json'),
    JSON.stringify([folder(FOLDER, 'Clients', null), folder(CHILD, 'Acme', FOLDER)]),
  );
  for (let day = 10; day <= 16; day += 1) {
    writeMeeting(root, {
      id: `bbbbbbbb-0000-4000-8000-0000000000${String(day)}`,
      title: `Meeting ${String(day)}`,
      recordedAt: `2026-09-${String(day)}T09:00:00.0000000+00:00`,
      // Odd days have a length and a ruling; even days do not, and one has no content at all.
      ...(day % 2 === 1 ? { endedAt: `2026-09-${String(day)}T10:30:00.0000000+00:00` } : {}),
      ...(day === 16 ? {} : { summary: `Planning notes for the release on day ${String(day)}.` }),
    });
  }
  writeMeeting(root, {
    id: 'bbbbbbbb-0000-4000-8000-000000000099',
    title: 'Inside a folder',
    recordedAt: '2026-09-09T09:00:00.0000000+00:00',
    endedAt: '2026-09-09T09:30:00.0000000+00:00',
    directory: 'Clients/Acme',
    folderId: CHILD,
    summary: 'Scope of the next phase.',
  });
}

/** Every violation inside the grid and the tree, and the serious ones anywhere on the page. */
async function expectNoViolations(target: Page): Promise<void> {
  await target.evaluate(axe.source);
  const report = await target.evaluate(async () => {
    const run = (window as unknown as { axe: typeof axe }).axe;
    const summarize = (violations: axe.Result[]) =>
      violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
      }));
    const scoped = await run.run({ include: [['[role="grid"]'], ['[role="tree"]']] });
    const whole = await run.run(document);
    return {
      scoped: summarize(scoped.violations),
      whole: summarize(whole.violations).filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      ),
      gridAndTreeChecked: scoped.passes.length,
    };
  });
  expect(report.scoped).toEqual([]);
  expect(report.whole).toEqual([]);
  expect(report.gridAndTreeChecked).toBeGreaterThan(0);
}

async function useLook(theme: 'light' | 'dark', tag: 'en-US' | 'es'): Promise<void> {
  await page.evaluate(
    async ({ theme: value, tag: language }) => {
      window.localStorage.setItem('vozella.theme', value);
      await window.vozella.invoke('settings.setUiLanguage', { tag: language });
    },
    { theme, tag },
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => {
    window.location.hash = '#/library';
  });
  await page.getByRole('tree').getByRole('treeitem').first().click();
  await expect(page.locator('[data-row-id]').first()).toBeVisible();
}

test.beforeAll(async () => {
  launched = await launchApp({}, seedLibrary);
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  // A color read in the middle of a transition is neither the old color nor the new one.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 760);
  });
});

test.afterAll(async () => {
  await launched.close();
});

for (const theme of ['light', 'dark'] as const) {
  test(`grid and tree, with a cursor, a hover, checks and marks, in ${theme}`, async () => {
    await useLook(theme, 'en-US');
    const rows = page.locator('[data-row-id]');
    await expect(rows.nth(0)).toHaveAttribute('data-cursor', 'true');
    await rows.nth(1).hover();
    await expectNoViolations(page);

    // Checked rows, with the bulk bar up, and the mouse on a checked row.
    await rows.nth(1).getByRole('checkbox').click();
    await rows.nth(2).getByRole('checkbox').click();
    await rows.nth(2).hover();
    await expect(page.getByRole('toolbar', { name: 'Checked meetings' })).toBeVisible();
    await expectNoViolations(page);
    await page
      .getByRole('toolbar', { name: 'Checked meetings' })
      .getByRole('button')
      .last()
      .click();

    // Marks, on the cursor row as well.
    await page.getByRole('searchbox').fill('planning');
    await expect(page.locator('mark').first()).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('searchbox').fill('');

    // A folder open in the tree, selected, with its own header.
    const clients = page.getByRole('treeitem', { name: /Clients/ });
    await clients.click();
    await clients.focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('treeitem', { name: /Acme/ }).click();
    await expect(page.locator('[data-row-id]').first()).toBeVisible();
    await expectNoViolations(page);
  });
}

test('in Spanish, in the smallest window, with no preview', async () => {
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(960, 700);
  });
  try {
    await useLook('light', 'es');
    await expect(page.getByTestId('library-preview')).toHaveCount(0);
    await expectNoViolations(page);
  } finally {
    await useLook('light', 'en-US');
    await launched.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 760);
    });
  }
});

test('a grid scrolled far, with its sticky day and a pinned row', async () => {
  await useLook('light', 'en-US');
  await page.locator('[data-row-id]').first().click();
  await page.getByRole('grid').evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(page.locator('[data-sticky="true"]')).toHaveCount(1);
  await expectNoViolations(page);
});
