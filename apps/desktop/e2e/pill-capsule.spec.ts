import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, seedReadySettings, type LaunchedApp } from './launch';
import { os, pixels, sleep } from './os/os';

// The capsule drawn in the pill window, checked on real composed screen pixels the way the window
// spike did: a magenta backdrop makes transparency visible, so the rounded corners, the single
// outline, the gutter and the signal red stop button are measured on the screen, not in the DOM.
// Fake native build, a unique VOZELLA_DATA_ROOT per launch (launch.ts). Windows only.
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/live-copilot.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/live-copilot');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';

// A run can lose the machine to another worktree's Electron for a moment: retry once.
test.describe.configure({ mode: 'serial', timeout: 180_000, retries: 1 });

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let launched: LaunchedApp;
let main: Page;
let scale = 1;
let wa: Rect = { x: 0, y: 0, width: 0, height: 0 };

const GUTTER = 8;

async function pillBounds(): Promise<Rect> {
  const bounds = await launched.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().endsWith('/pill.html'),
    );
    return w ? w.getBounds() : null;
  });
  if (!bounds) throw new Error('the pill window does not exist');
  return bounds;
}

async function pillPage(): Promise<Page> {
  const found = launched.app.windows().find((p) => p.url().endsWith('/pill.html'));
  if (!found) throw new Error('no pill page');
  return found;
}

/** DIP screen points to physical pixels, the way the OS places them. */
async function physical(points: { x: number; y: number }[]): Promise<{ x: number; y: number }[]> {
  return launched.app.evaluate(
    ({ screen }, pts) => pts.map((p) => screen.dipToScreenPoint({ x: p.x, y: p.y })),
    points,
  );
}

/** The box of a page element in screen DIP (the window is frameless, so no inset). */
async function boxOf(selector: string): Promise<Rect> {
  const page = await pillPage();
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const b = await pillBounds();
  return { x: b.x + box.x, y: b.y + box.y, width: box.width, height: box.height };
}

async function pixelsAt(points: { x: number; y: number }[]): Promise<number[][]> {
  return pixels(await physical(points));
}

async function waitSettled(check: (b: Rect) => boolean): Promise<void> {
  await expect
    .poll(
      async () => {
        const first = await pillBounds();
        if (!check(first)) return false;
        await sleep(300);
        const second = await pillBounds();
        return check(second) && JSON.stringify(first) === JSON.stringify(second);
      },
      { timeout: 8_000, intervals: [100] },
    )
    .toBe(true);
}

const isMagenta = (p: number[] | undefined): boolean =>
  !!p && (p[0] ?? 0) > 150 && (p[2] ?? 0) > 150 && (p[1] ?? 0) < 120;
const near = (p: number[] | undefined, want: number[], tolerance: number): boolean =>
  !!p && want.every((v, i) => Math.abs((p[i] ?? 0) - v) <= tolerance);

// Dark tokens: paper-raised #171717 is the surface, hairline #262626 the outline, signal #ff5a4f.
const SURFACE = [23, 23, 23];
const HAIRLINE = [38, 38, 38];
const SIGNAL = [255, 90, 79];

async function snap(name: string): Promise<void> {
  if (!shots) return;
  fs.mkdirSync(outDir, { recursive: true });
  const b = await pillBounds();
  const [a] = await physical([{ x: b.x - 40, y: b.y - 40 }]);
  if (!a) return;
  os(
    'shot',
    path.join(outDir, name),
    Math.round(a.x),
    Math.round(a.y),
    Math.round((b.width + 80) * scale),
    Math.round((b.height + 80) * scale),
  );
}

async function setAppTheme(preference: 'light' | 'dark'): Promise<void> {
  await main.evaluate(
    (p) => window.vozella.invoke('app.setThemePreference', { preference: p }),
    preference,
  );
  await sleep(300);
}

test.beforeAll(async () => {
  launched = await launchApp({ ...readyEnv, VOZELLA_E2E_SHOW: '1' }, seedReadySettings);
  main = await launched.app.firstWindow();
  await expect(main.getByRole('navigation')).toBeVisible();
  await main.getByRole('link', { name: 'Record' }).click();
  await installEngine(main);
  const screenInfo = await launched.app.evaluate(({ screen }) => ({
    wa: screen.getPrimaryDisplay().workArea,
    scale: screen.getPrimaryDisplay().scaleFactor,
  }));
  wa = screenInfo.wa;
  scale = screenInfo.scale;
  await launched.app.evaluate(({ BrowserWindow }, area) => {
    const backdrop = new BrowserWindow({
      ...area,
      frame: false,
      backgroundColor: '#ff00ff',
      show: true,
      focusable: false,
      skipTaskbar: true,
    });
    void backdrop.loadURL('data:text/html,<body style="background:%23ff00ff">');
    const work = new BrowserWindow({
      x: area.x + 300,
      y: area.y + 200,
      width: 500,
      height: 300,
      show: true,
      title: 'WORK-WINDOW',
      backgroundColor: '#ffffff',
    });
    void work.loadURL('data:text/html,<title>WORK-WINDOW</title><input autofocus>');
    work.focus();
  }, wa);
  await sleep(800);
});

test.afterAll(async () => {
  await main.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
});

test('a take starts: the started hint shows on the capsule for about 2.5 s and goes away', async () => {
  const start = await main.evaluate(() =>
    window.vozella.invoke('recording.start', {
      title: 'Capsule e2e',
      folderId: null,
      microphone: null,
      appName: null,
    }),
  );
  expect(start).toMatchObject({ started: true });

  // The pill page exists a moment after the start; the hint waits for the entrance to finish.
  await expect
    .poll(() => launched.app.windows().some((p) => p.url().endsWith('/pill.html')))
    .toBe(true);
  const page = await pillPage();
  const hint = page.getByRole('status');
  await expect(hint).toHaveText('Recording started', { timeout: 6_000 });
  // Away from the docked edge: the pill starts on the right.
  await expect(hint).toHaveAttribute('data-side', 'left');
  const shownAt = Date.now();
  await expect(hint).toHaveCount(0, { timeout: 5_000 });
  const shownFor = Date.now() - shownAt;
  expect(shownFor).toBeGreaterThan(1_000);
  expect(shownFor).toBeLessThanOrEqual(3_500);
  // The logo keeps its own tooltip, separate from the hint.
  await expect(page.locator('#BtnLiveCopilotLogoOpenApp')).toHaveAttribute('title', 'Open Vozella');
});

test('the capsule has the six items, the AutomationIds and the English names', async () => {
  const page = await pillPage();
  await expect(page.locator('#LiveCopilotCapsule')).toHaveAttribute('data-orientation', 'vertical');
  for (const [id, name] of [
    ['BtnLiveCopilotLogoOpenApp', 'Open Vozella'],
    ['BtnLiveCopilotPause', 'Pause recording'],
    ['BtnLiveCopilotStop', 'Stop recording'],
    ['BtnLiveCopilotChat', 'Expand live copilot'],
  ] as const) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-label', name);
  }
  await expect(page.locator('#TxtLiveCopilotElapsed')).toHaveText(/^\d{2,}:\d{2}$/);
  await expect(page.locator('#TxtLiveCopilotElapsed')).toHaveAttribute('title', 'REC');
});

test('pixels: transparent gutter, round corner, dark surface, one outline, signal red stop', async () => {
  await sleep(500);
  const b = await pillBounds();
  const cap = await boxOf('#LiveCopilotCapsule');
  await snap('pill-right-dark.png');

  // Gutter: the window corners show the backdrop untouched.
  const [gutterA, gutterB] = await pixelsAt([
    { x: b.x + 1, y: b.y + 1 },
    { x: b.x + b.width - 2, y: b.y + b.height - 2 },
  ]);
  expect(gutterA).toEqual([255, 0, 255]);
  expect(gutterB).toEqual([255, 0, 255]);

  // Rounded: the capsule box corner shows the backdrop, the surface sits beside the buttons.
  const midY = cap.y + Math.trunc(cap.height / 2);
  const [corner, surface] = await pixelsAt([
    { x: cap.x + 3, y: cap.y + 3 },
    { x: cap.x + 6, y: midY },
  ]);
  expect(corner?.[0]).toBeGreaterThan(220);
  expect(corner?.[1]).toBeLessThan(10);
  expect(near(surface, SURFACE, 2)).toBe(true);

  // Exactly one outline ring across the left edge: backdrop, the hairline, then surface only.
  const [origin] = await physical([{ x: cap.x, y: midY }]);
  if (!origin) throw new Error('no origin');
  const line = Array.from({ length: 12 }, (_, i) => ({ x: origin.x - 4 + i, y: origin.y }));
  const row = pixels(line);
  const ring = row.map((p) => near(p, HAIRLINE, 4));
  const firstRing = ring.indexOf(true);
  expect(firstRing).toBeGreaterThan(0);
  const width = Math.max(1, Math.floor(scale));
  expect(ring.filter(Boolean).length).toBe(width);
  expect(row.slice(0, firstRing).every((p) => isMagenta(p))).toBe(true);
  expect(
    row.slice(firstRing + width + 1).every((p) => near(p, SURFACE, 2) || !near(p, HAIRLINE, 4)),
  ).toBe(true);
  expect(
    row.slice(firstRing + width, firstRing + width + 3).every((p) => near(p, SURFACE, 2)),
  ).toBe(true);

  // The stop button is the signal red (off the white glyph in its middle).
  const stop = await boxOf('#BtnLiveCopilotStop');
  const [stopPixel] = await pixelsAt([
    { x: stop.x + stop.width / 2 + 11, y: stop.y + stop.height / 2 },
  ]);
  expect(near(stopPixel, SIGNAL, 3)).toBe(true);
});

test('pause swaps the glyph and name, the bars rest as dots, and resume brings them back', async () => {
  const page = await pillPage();
  await page.locator('#BtnLiveCopilotPause').click();
  await expect(page.locator('#BtnLiveCopilotPause')).toHaveAttribute(
    'aria-label',
    'Resume recording',
  );
  await expect(page.locator('#BtnLiveCopilotPause')).toHaveAttribute('data-glyph', 'play');
  await expect(page.locator('#TxtLiveCopilotElapsed')).toHaveAttribute('title', 'Paused');
  // The bars decay toward the 3 DIP rest at 0.14 per 33 ms tick: they settle within a second.
  await expect
    .poll(
      () =>
        page
          .locator('[data-bar]')
          .evaluateAll((bars) =>
            bars.map((bar) => Math.round((bar as HTMLElement).getBoundingClientRect().height)),
          ),
      { timeout: 4_000 },
    )
    .toEqual([3, 3, 3, 3, 3]);
  await page.locator('#BtnLiveCopilotPause').click();
  await expect(page.locator('#BtnLiveCopilotPause')).toHaveAttribute(
    'aria-label',
    'Pause recording',
  );
});

test('the elapsed text counts while recording', async () => {
  const page = await pillPage();
  const first = await page.locator('#TxtLiveCopilotElapsed').textContent();
  await expect
    .poll(() => page.locator('#TxtLiveCopilotElapsed').textContent(), { timeout: 4_000 })
    .not.toBe(first);
});

test('expanded: the capsule radius is 28, a collapsed one is a full round', async () => {
  test.skip(wa.height < 516, 'the work area is shorter than the panel');
  const page = await pillPage();
  const radiusAt = async (): Promise<string> =>
    page.locator('#LiveCopilotCapsule').evaluate((el) => (el as HTMLElement).style.borderRadius);

  // Collapsed, at 8.8 DIP in along the diagonal of the box corner: outside a 32 radius.
  const inset = 8.8;
  const collapsedCap = await boxOf('#LiveCopilotCapsule');
  expect(await radiusAt()).toBe('32px');
  const [collapsedPixel] = await pixelsAt([
    { x: collapsedCap.x + inset, y: collapsedCap.y + inset },
  ]);
  expect(isMagenta(collapsedPixel)).toBe(true);

  await page.locator('#BtnLiveCopilotChat').click();
  await expect(page.locator('#BtnLiveCopilotChat')).toHaveAttribute('aria-expanded', 'true');
  await waitSettled((r) => r.width > 400);
  await sleep(400);
  expect(await radiusAt()).toBe('28px');
  await expect(page.locator('#BtnLiveCopilotChat')).toHaveAttribute(
    'aria-label',
    'Collapse live copilot',
  );
  const expandedCap = await boxOf('#LiveCopilotCapsule');
  const [expandedPixel] = await pixelsAt([{ x: expandedCap.x + inset, y: expandedCap.y + inset }]);
  // Inside a 28 radius at the same inset: the surface, not the backdrop.
  expect(isMagenta(expandedPixel)).toBe(false);
  await snap('pill-expanded-dark.png');

  await page.locator('#BtnLiveCopilotChat').click();
  await waitSettled((r) => r.width < 100);
  expect(await radiusAt()).toBe('32px');
});

test('docked on top the capsule lays out horizontally and keeps one outline', async () => {
  const b = await pillBounds();
  const page = await pillPage();
  // Grab the surface above the buttons' column and drop it near the top edge.
  const from = { x: b.x + b.width / 2 + 24, y: b.y + b.height / 2 };
  const to = { x: wa.x + wa.width / 2, y: wa.y + 60 };
  const [a, z] = await physical([from, to]);
  if (!a || !z) throw new Error('no points');
  os('drag2', Math.round(a.x), Math.round(a.y), Math.round(z.x), Math.round(z.y));
  await waitSettled((r) => r.width > 200 && r.y === wa.y + 16 - GUTTER);
  await expect(page.locator('#LiveCopilotCapsule')).toHaveAttribute(
    'data-orientation',
    'horizontal',
  );
  await sleep(500);

  const cap = await boxOf('#LiveCopilotCapsule');
  expect(Math.round(cap.width)).toBe(272);
  expect(Math.round(cap.height)).toBe(64);
  const midX = cap.x + Math.trunc(cap.width / 2);
  const [origin] = await physical([{ x: midX, y: cap.y }]);
  if (!origin) throw new Error('no origin');
  const column = pixels(
    Array.from({ length: 8 }, (_, i) => ({ x: origin.x, y: origin.y - 3 + i })),
  );
  const ring = column.map((p) => near(p, HAIRLINE, 4));
  expect(ring.filter(Boolean).length).toBe(Math.max(1, Math.floor(scale)));
  await snap('pill-top-dark.png');
});

test('the app theme does not change the pill: it is dark in light mode too', async () => {
  await setAppTheme('light');
  const page = await pillPage();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  const cap = await boxOf('#LiveCopilotCapsule');
  const [surface] = await pixelsAt([{ x: cap.x + cap.width / 2, y: cap.y + 5 }]);
  expect(near(surface, SURFACE, 2)).toBe(true);
  await snap('pill-top-app-light.png');
  await setAppTheme('dark');
});
