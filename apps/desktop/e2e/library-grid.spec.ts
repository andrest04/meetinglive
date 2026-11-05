import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The sticky day header and the pinned focused row depend on real scrolling and layout, which
// jsdom has neither of. This is the proof the grid's recipe works in the real renderer.

test.describe.configure({ timeout: 150_000 });

let launched: LaunchedApp;
let page: Page;
let grid: Locator;

const DAYS = 30;
const PER_DAY = 6;
const pad = (n: number): string => String(n).padStart(2, '0');

test.beforeAll(async () => {
  launched = await launchApp({}, (dataRoot) => {
    const root = path.join(dataRoot, 'meetings');
    for (let day = 1; day <= DAYS; day += 1) {
      for (let slot = 0; slot < PER_DAY; slot += 1) {
        const hour = pad(8 + slot);
        const id = `${pad(day)}${pad(slot)}0000-0000-4000-8000-000000000000`;
        writeMeeting(root, {
          id,
          title: `Meeting ${pad(day)}-${pad(slot)}`,
          recordedAt: `2026-08-${pad(day)}T${hour}:00:00.0000000+00:00`,
          summary: `Snippet of ${pad(day)}-${pad(slot)}`,
        });
      }
    }
  });
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 760);
  });
  await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  grid = page.getByRole('grid', { name: 'Library' });
  await expect(grid).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

/** Scrolls and lets the virtualizer render for the new offset. */
async function scrollTo(top: number): Promise<void> {
  await grid.evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBe(top);
  await page.waitForTimeout(150);
}

const rowIndexes = (): Promise<number[]> =>
  grid
    .locator('[role="row"]')
    .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute('aria-rowindex'))));

test('each row fills the slot the list gives it, so the rows sit edge to edge', async () => {
  await scrollTo(0);
  const edges = await grid
    .locator('[role="row"]')
    .evaluateAll((rows) =>
      rows
        .slice(0, 8)
        .map((row) => [row.getBoundingClientRect().top, row.getBoundingClientRect().bottom]),
    );
  for (let index = 1; index < edges.length; index += 1) {
    expect(edges[index]?.[0]).toBe(edges[index - 1]?.[1]);
  }
});

test('the smallest window has no preview, so it puts no cursor on a row', async () => {
  const resize = (width: number) =>
    launched.app.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(value, 760);
    }, width);
  await resize(960);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(992);
  await page.reload();
  await expect(grid).toBeVisible();
  await expect(grid.locator('[data-row-id]').first()).toBeVisible();
  // Coming back finds the list already loaded, before the route has measured its width.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Library' }).click();
  await expect(grid.locator('[data-row-id]').first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect(grid.locator('[data-cursor]')).toHaveCount(0);
  await resize(1180);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(1100);
  await page.reload();
  await expect(grid.locator('[data-cursor]')).toHaveCount(1);
});

test('virtualizes: a few rows in the DOM out of many, with a count for assistive tech', async () => {
  const total = DAYS * (PER_DAY + 1);
  await expect(grid).toHaveAttribute('aria-rowcount', String(total));
  const rows = await rowIndexes();
  expect(rows.length).toBeGreaterThan(5);
  expect(rows.length).toBeLessThan(60);
});

test('the day header sticks to the top once its row is scrolled past, with no duplicate', async () => {
  await scrollTo(0);
  const gridTop = (await grid.boundingBox())?.y ?? 0;

  // The newest day has one header and six rows: 32 + 6 * 64. Stop 100 px into the next day.
  const dayHeight = 32 + PER_DAY * 64;
  await scrollTo(dayHeight * 5 + 100);

  const stuck = grid.locator('[data-sticky="true"]');
  await expect(stuck).toHaveCount(1);
  const box = await stuck.boundingBox();
  expect(Math.round(box?.y ?? -1)).toBe(Math.round(gridTop));
  expect(await stuck.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

  // It names the day of the rows under it: the sixth newest day.
  await expect(stuck.getByRole('rowheader')).toContainText(/25 August/);
  // The first meeting row whose bottom is below the header belongs to that same day.
  const firstVisible = await grid.locator('[data-row-id]').evaluateAll((rows, floor) => {
    const visible = rows
      .map((row) => ({
        text: row.textContent,
        bottom: row.getBoundingClientRect().bottom,
        top: row.getBoundingClientRect().top,
      }))
      .filter((row) => row.bottom > floor)
      .sort((a, b) => a.top - b.top);
    return visible[0]?.text ?? '';
  }, gridTop + 32);
  expect(firstVisible).toContain('Meeting 25-');

  // Every row index appears once: no clone beside the original.
  const rows = await rowIndexes();
  expect(new Set(rows).size).toBe(rows.length);

  // It stays stuck on the way down, and the old header scrolled away.
  await scrollTo(dayHeight * 12 + 40);
  await expect(stuck).toHaveCount(1);
  expect(Math.round((await stuck.boundingBox())?.y ?? -1)).toBe(Math.round(gridTop));
  await expect(stuck.getByRole('rowheader')).toContainText(/18 August/);

  // Back at the top, the first header sits in its own place.
  await scrollTo(0);
  await expect(stuck.getByRole('rowheader')).toContainText(/30 August/);
  expect(Math.round((await stuck.boundingBox())?.y ?? -1)).toBe(Math.round(gridTop));
});

test('the focused row stays in the DOM, focused, when scrolled far away', async () => {
  await scrollTo(0);
  const first = grid.getByRole('row', { name: /Meeting 30-05/ });
  await first.focus();
  await expect(first).toBeFocused();

  await scrollTo(4000);
  await expect(first).toBeAttached();
  await expect(first).toBeFocused();
  const rows = await rowIndexes();
  expect(new Set(rows).size).toBe(rows.length);
  // It is far above the view, and pinned, not stuck on screen.
  const gridTop = (await grid.boundingBox())?.y ?? 0;
  expect((await first.boundingBox())?.y ?? 0).toBeLessThan(gridTop);

  // A key brings it back, on the row after it, clear of the sticky header (WCAG 2.4.11).
  await page.keyboard.press('ArrowDown');
  const next = grid.getByRole('row', { name: /Meeting 30-04/ });
  await expect(next).toBeFocused();
  await expect
    .poll(async () => (await next.boundingBox())?.y ?? 0)
    .toBeGreaterThanOrEqual(gridTop + 32);
});

test('coming back from a meeting restores the row and the scroll', async () => {
  await scrollTo(3000);
  // A row fully in view, chosen by name: a position in the DOM moves as the window renders.
  const floor = ((await grid.boundingBox())?.y ?? 0) + 32;
  const nameInView = (): Promise<string> =>
    grid.locator('[data-row-id]').evaluateAll((rows, top) => {
      const inView = rows.find((row) => row.getBoundingClientRect().top >= top);
      return inView?.querySelector('[data-title]')?.textContent ?? '';
    }, floor);
  // In an off-screen window the rows for a new offset can take longer than the wait in scrollTo.
  await expect.poll(nameInView).not.toBe('');
  const name = await nameInView();
  await grid.getByRole('row', { name: new RegExp(name) }).dblclick();
  await expect(page).toHaveURL(/#\/session$/);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/library$/);
  await expect(grid).toBeVisible();
  await expect.poll(() => grid.evaluate((el) => Math.round(el.scrollTop))).toBe(3000);
  await expect(grid.locator('[data-row-id][data-cursor="true"] [data-title]')).toHaveText(name);
});

test('a row being dragged stays in the DOM when the list scrolls away from it', async () => {
  await scrollTo(0);
  const dragged = grid.getByRole('row', { name: /Meeting 30-03/ });
  await dragged.hover();
  await page.mouse.down();
  await page.mouse.move(300, 300, { steps: 4 });
  await scrollTo(6000);
  await expect(dragged).toBeAttached();
  const gridTop = (await grid.boundingBox())?.y ?? 0;
  expect((await dragged.boundingBox())?.y ?? 0).toBeLessThan(gridTop);
  const rows = await rowIndexes();
  expect(new Set(rows).size).toBe(rows.length);
  await page.mouse.up();
  await scrollTo(0);
});

test('the ruling shows the length only when the meeting has one', async () => {
  // The seeded meetings have no end time, so nothing is darkened and no duration is shown.
  await expect(grid.locator('[data-ruling]')).toHaveCount(0);
  await expect(grid.getByText(/\d+ min/)).toHaveCount(0);
});
