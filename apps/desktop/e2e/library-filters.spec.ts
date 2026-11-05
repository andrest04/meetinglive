import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Date and status filters in the real renderer, over files on disk and the real search channel.

test.describe.configure({ mode: 'serial', timeout: 150_000 });

let launched: LaunchedApp;
let page: Page;

const FOLDER = 'aaaaaaaa-0000-4000-8000-000000000001';

const pad = (n: number): string => String(n).padStart(2, '0');

function localDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return date;
}

const dayText = (date: Date): string =>
  `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function stamp(daysAgo: number): string {
  const date = localDate(daysAgo);
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${dayText(date)}T12:00:00.0000000${zone}`;
}

function seedLibrary(dataRoot: string): void {
  const root = path.join(dataRoot, 'meetings');
  fs.mkdirSync(path.join(root, 'Clients'), { recursive: true });
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
  const id = (n: number): string => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
  writeMeeting(root, {
    id: id(1),
    title: 'Recent summary',
    recordedAt: stamp(1),
    summary: 'The plan for the release.',
  });
  writeMeeting(root, {
    id: id(2),
    title: 'Recent transcript',
    recordedAt: stamp(2),
    transcript: '[00:00:04] Ana: We talked about pelicans.',
  });
  writeMeeting(root, {
    id: id(3),
    title: 'Older summary',
    recordedAt: stamp(20),
    summary: 'Pelicans came up again.',
  });
  writeMeeting(root, { id: id(4), title: 'Old and bare', recordedAt: stamp(60) });
  writeMeeting(root, {
    id: id(5),
    title: 'Client recent',
    recordedAt: stamp(3),
    directory: 'Clients',
    folderId: FOLDER,
    summary: 'Scope for the client.',
  });
}

const rows = (): Locator => page.locator('[role="row"][data-row-id]');
const row = (title: string): Locator => rows().filter({ hasText: title });
const button = (): Locator => page.getByRole('button', { name: /^Filters/ });
const dialog = (): Locator => page.getByRole('dialog', { name: 'Filters' });
const count = (): Locator => page.getByTestId('library-view-count');
const chips = (): Locator => page.getByRole('group', { name: 'Active filters' });

async function backToAllWithNoFilters(): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/library';
  });
  await page.getByRole('tree').getByRole('treeitem').first().click();
  await page.getByRole('searchbox').fill('');
  const clear = chips().getByRole('button', { name: 'Clear filters' });
  if (await clear.isVisible()) await clear.click();
  await expect(chips()).toHaveCount(0);
  await expect(rows()).toHaveCount(5);
}

async function choose(...names: readonly string[]): Promise<void> {
  await button().click();
  for (const name of names) await dialog().getByRole('radio', { name, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
}

async function expectNoViolations(): Promise<void> {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    // Base UI's own focus guards are tabbable and aria-hidden by design: a guard hands the focus on
    // as soon as it gets it, so no one rests there. Every open overlay of the kit has them.
    const results = await (window as unknown as { axe: typeof axe }).axe.run({
      exclude: [['[data-base-ui-focus-guard]']],
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }));
  });
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
}

async function useTheme(theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await backToAllWithNoFilters();
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

test('the keyboard does all of it, and the focus comes back to the button', async () => {
  await backToAllWithNoFilters();
  await page.getByRole('searchbox').focus();
  await page.keyboard.press('Tab');
  await expect(button()).toBeFocused();
  await expect(button()).toHaveAccessibleName('Filters');

  await page.keyboard.press('Enter');
  await expect(dialog()).toBeVisible();
  await expect(dialog().getByRole('radio', { name: 'Any time' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(dialog().getByRole('radio', { name: 'Last 7 days' })).toBeChecked();

  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await expect(button()).toBeFocused();
  await expect(button()).toHaveAccessibleName('Filters active: 1');
  await expect(count()).toHaveText('3 of 5');
  await expect(rows()).toHaveCount(3);

  // A chip goes from the keyboard too, and the focus does not fall out of the page.
  await page.getByRole('button', { name: 'Remove filter: Last 7 days' }).focus();
  await page.keyboard.press('Enter');
  await expect(chips()).toHaveCount(0);
  await expect(button()).toBeFocused();
  await expect(count()).toHaveText('5');
});

test('a custom range takes both of its ends, and the status narrows it further', async () => {
  await backToAllWithNoFilters();
  await button().click();
  await dialog().getByRole('radio', { name: 'Custom range' }).click();
  await expect(rows()).toHaveCount(5);
  await dialog()
    .getByLabel('From', { exact: true })
    .fill(dayText(localDate(2)));
  await dialog()
    .getByLabel('To', { exact: true })
    .fill(dayText(localDate(1)));
  await expect(rows()).toHaveCount(2);
  await expect(row('Recent summary')).toBeVisible();
  await expect(row('Recent transcript')).toBeVisible();
  await dialog().getByRole('radio', { name: 'Without summary' }).click();
  await expect(rows()).toHaveCount(1);
  await expect(row('Recent transcript')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chips().getByText('Without summary')).toBeVisible();
  await expect(chips().getByRole('button', { name: /^Remove filter: .+ to .+/ })).toBeVisible();
});

test('a word found only inside a meeting is filtered too', async () => {
  await backToAllWithNoFilters();
  const search = page.getByRole('searchbox');
  await search.fill('pelicans');
  await expect(rows()).toHaveCount(2);
  await choose('Last 7 days');
  await expect(rows()).toHaveCount(1);
  await expect(row('Recent transcript')).toBeVisible();
  await expect(count()).toHaveText('1 of 5');
  await expect(page.getByText('Matches: 1')).toBeVisible();
});

test('the list, its days and Ctrl+A work on what is left, and Esc keeps its order', async () => {
  await backToAllWithNoFilters();
  await choose('With summary');
  await expect(rows()).toHaveCount(3);
  await expect(page.locator('[role="rowheader"]')).toHaveCount(3);

  await row('Recent summary').click();
  await page.keyboard.press('Control+a');
  const bar = page.getByRole('toolbar', { name: 'Checked meetings' });
  await expect(bar.getByText('Checked: 3')).toBeVisible();

  // Esc on a row clears the checks, then the search, and never the filters.
  await page.getByRole('searchbox').fill('summary');
  await row('Recent summary').click();
  await page.keyboard.press('Control+a');
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveValue('summary');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(chips().getByText('With summary')).toBeVisible();

  // A change of filter drops the checks.
  await row('Recent summary').getByRole('checkbox').click();
  await expect(bar).toBeVisible();
  await choose('Last 30 days');
  await expect(bar).toHaveCount(0);
});

test('they stay through folders and a meeting, and leave with one quiet line', async () => {
  await backToAllWithNoFilters();
  await choose('Last 7 days');
  await page.getByRole('treeitem', { name: /Clients/ }).click();
  await expect(rows()).toHaveCount(1);
  await expect(count()).toHaveText('1 of 1');

  await row('Client recent').dblclick();
  await expect(page).toHaveURL(/#\/session/);
  await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  await expect(row('Client recent')).toBeVisible();
  await expect(chips().getByText('Last 7 days')).toBeVisible();

  await choose('Without summary');
  await expect(page.getByText('No meetings match these filters.')).toBeVisible();
  await expect(count()).toHaveText('0 of 1');
  await page.getByRole('button', { name: 'Clear filters' }).last().click();
  await expect(row('Client recent')).toBeVisible();
  await expect(count()).toHaveText('1');
  await expect(button()).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
  test(`axe with the menu, the chips and the empty line, in ${theme}`, async () => {
    await useTheme(theme);
    await button().click();
    await dialog().getByRole('radio', { name: 'Custom range' }).click();
    await dialog()
      .getByLabel('From', { exact: true })
      .fill(dayText(localDate(10)));
    await expectNoViolations();
    await page.keyboard.press('Escape');
    await expect(dialog()).toHaveCount(0);
    await expectNoViolations();

    await choose('Without transcript', 'With summary');
    await expectNoViolations();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await choose('Last 7 days');
    await page.getByRole('searchbox').fill('bare');
    await expect(page.getByText('No meetings match these filters.')).toBeVisible();
    await expectNoViolations();
    await page.getByRole('searchbox').fill('');
  });
}

test('forced colors still show that filters are on', async () => {
  await useTheme('light');
  await page.emulateMedia({ forcedColors: 'active' });
  try {
    await expect(page.getByTestId('library-filter-mark')).toHaveCount(0);
    await choose('Last 7 days');
    const mark = page.getByTestId('library-filter-mark');
    await expect(mark).toBeVisible();
    const colors = await mark.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'CanvasText';
      document.body.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: getComputedStyle(el).backgroundColor, expected };
    });
    expect(colors.actual).toBe(colors.expected);
    const edge = await chips()
      .locator('span')
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(edge).toBe('solid');
  } finally {
    await page.emulateMedia({ forcedColors: 'none' });
  }
});
