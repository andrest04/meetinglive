import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, seedReadySettings, type LaunchedApp } from './launch';
import { os, pixels, sleep } from './os/os';

// The live copilot pill window on the fake native build, checked at the OS level the way the
// window spike did: a magenta backdrop so transparency is visible, a "work" window that owns
// focus, real composed pixels and real mouse input (e2e/os/os.ps1). Windows only.
//
// The pill is driven by the real path: a fake recording starts, the handoff minimizes the main
// window, the pill slides in. Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens.

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

interface PillInfo {
  bounds: Rect;
  content: Rect;
  visible: boolean;
  focused: boolean;
  title: string;
  alwaysOnTop: boolean;
  resizable: boolean;
  minimizable: boolean;
  maximizable: boolean;
  fullscreenable: boolean;
  hwnd: string;
}

interface Screen {
  wa: Rect;
  scale: number;
}

let launched: LaunchedApp;
let main: Page;
let scale = 1;
let wa: Rect = { x: 0, y: 0, width: 0, height: 0 };

const GUTTER = 8;
const CAPSULE_SHORT = 64;
const VERTICAL_LONG = 240;
const HORIZONTAL_LONG = 272;
const MARGIN = 16;

async function pillInfo(): Promise<PillInfo | null> {
  return launched.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().endsWith('/pill.html'),
    );
    if (!w) return null;
    return {
      bounds: w.getBounds(),
      content: w.getContentBounds(),
      visible: w.isVisible(),
      focused: w.isFocused(),
      title: w.getTitle(),
      alwaysOnTop: w.isAlwaysOnTop(),
      resizable: w.isResizable(),
      minimizable: w.isMinimizable(),
      maximizable: w.isMaximizable(),
      fullscreenable: w.isFullScreenable(),
      hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(),
    };
  });
}

async function mustPill(): Promise<PillInfo> {
  const info = await pillInfo();
  if (!info) throw new Error('the pill window does not exist');
  return info;
}

/** DIP points to physical screen pixels, the way the OS places them (any monitor layout). */
async function physical(points: { x: number; y: number }[]): Promise<{ x: number; y: number }[]> {
  return launched.app.evaluate(
    ({ screen }, pts) => pts.map((p) => screen.dipToScreenPoint({ x: p.x, y: p.y })),
    points,
  );
}

async function pillPage(): Promise<Page> {
  const found = launched.app.windows().find((p) => p.url().endsWith('/pill.html'));
  if (!found) throw new Error('no pill page');
  return found;
}

/** Waits until the check holds and the bounds stop changing (a tween has ended). */
async function waitForPill(
  what: string,
  check: (info: PillInfo) => boolean,
  timeout = 8_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const first = await pillInfo();
        if (!first || !check(first)) return false;
        await sleep(300);
        const second = await pillInfo();
        return (
          second !== null &&
          check(second) &&
          JSON.stringify(first.bounds) === JSON.stringify(second.bounds)
        );
      },
      { message: what, timeout, intervals: [100] },
    )
    .toBe(true);
}

/** getBounds can read 1 DIP off when the OS puts a window on a fractional physical pixel. */
function expectSize(b: Rect, width: number | undefined, height: number | undefined): void {
  expect(Math.abs(b.width - (width ?? b.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(b.height - (height ?? b.height))).toBeLessThanOrEqual(1);
}

const center = (r: Rect): { x: number; y: number } => ({
  x: r.x + Math.trunc(r.width / 2),
  y: r.y + Math.trunc(r.height / 2),
});

/** Where the window of a docked capsule sits for an edge, at the middle of the free travel. */
function expectedDock(edge: 'Left' | 'Right' | 'Top' | 'Bottom'): Partial<Rect> {
  switch (edge) {
    case 'Right':
      return {
        x: wa.x + wa.width - CAPSULE_SHORT - MARGIN - GUTTER,
        width: CAPSULE_SHORT + 2 * GUTTER,
        height: VERTICAL_LONG + 2 * GUTTER,
      };
    case 'Left':
      return {
        x: wa.x + MARGIN - GUTTER,
        width: CAPSULE_SHORT + 2 * GUTTER,
        height: VERTICAL_LONG + 2 * GUTTER,
      };
    case 'Top':
      return {
        y: wa.y + MARGIN - GUTTER,
        width: HORIZONTAL_LONG + 2 * GUTTER,
        height: CAPSULE_SHORT + 2 * GUTTER,
      };
    case 'Bottom':
      return {
        y: wa.y + wa.height - CAPSULE_SHORT - MARGIN - GUTTER,
        width: HORIZONTAL_LONG + 2 * GUTTER,
        height: CAPSULE_SHORT + 2 * GUTTER,
      };
  }
}

/**
 * A point on the capsule surface that is not a button, so a real mouse press starts a window drag
 * (the buttons are no-drag): beside the middle button when vertical, in the left cap when horizontal.
 */
function grabPoint(b: Rect): { x: number; y: number } {
  const c = center(b);
  return b.width < 200 ? { x: c.x - 18, y: c.y - 28 } : { x: b.x + GUTTER + 7, y: c.y };
}

/** A real mouse drag from the window center, so the window moves by (dx, dy) DIP. */
async function dragBy(dx: number, dy: number, from?: { x: number; y: number }): Promise<void> {
  const info = await mustPill();
  from ??= grabPoint(info.bounds);
  const [a, b] = await physical([from, { x: from.x + dx, y: from.y + dy }]);
  if (!a || !b) throw new Error('no physical points');
  os('drag2', Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y));
}

async function snapScreenshot(name: string): Promise<void> {
  if (!shots) return;
  fs.mkdirSync(outDir, { recursive: true });
  const info = await mustPill();
  const [a] = await physical([{ x: info.bounds.x - 40, y: info.bounds.y - 40 }]);
  if (!a) return;
  os(
    'shot',
    path.join(outDir, name),
    Math.round(a.x),
    Math.round(a.y),
    Math.round((info.bounds.width + 80) * scale),
    Math.round((info.bounds.height + 80) * scale),
  );
}

async function setWork(bounds: Rect): Promise<void> {
  await launched.app.evaluate((_, b) => {
    const g = globalThis as unknown as { __e2e: { work: Electron.BrowserWindow } };
    g.__e2e.work.setBounds(b);
  }, bounds);
}

async function focusWork(): Promise<void> {
  await launched.app.evaluate(() => {
    const g = globalThis as unknown as { __e2e: { work: Electron.BrowserWindow } };
    g.__e2e.work.focus();
  });
}

test.beforeAll(async () => {
  launched = await launchApp({ ...readyEnv, VOZELLA_E2E_SHOW: '1' }, seedReadySettings);
  main = await launched.app.firstWindow();
  await expect(main.getByRole('navigation')).toBeVisible();
  await main.getByRole('link', { name: 'Record' }).click();
  await installEngine(main);

  const screenInfo: Screen = await launched.app.evaluate(({ screen }) => ({
    wa: screen.getPrimaryDisplay().workArea,
    scale: screen.getPrimaryDisplay().scaleFactor,
  }));
  wa = screenInfo.wa;
  scale = screenInfo.scale;
  // Magenta backdrop over the work area, and a white "user's work" window that owns focus.
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
    (globalThis as unknown as { __e2e: unknown }).__e2e = { backdrop, work };
  }, wa);
  await sleep(800);
});

test.afterAll(async () => {
  await main.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  await launched.close();
});

test('the pill does not exist until a take starts', async () => {
  expect(await pillInfo()).toBeNull();
});

test('a take starts: the main window is minimized and the pill appears docked right, without focus', async () => {
  await focusWork();
  const start = await main.evaluate(() =>
    window.vozella.invoke('recording.start', {
      title: 'Pill e2e',
      folderId: null,
      microphone: null,
      appName: null,
    }),
  );
  expect(start).toMatchObject({ started: true });

  await waitForPill('visible and settled', (i) => {
    const e = expectedDock('Right');
    return i.visible && i.bounds.x === e.x && i.bounds.width === e.width;
  });
  const mainMinimized = await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter(
        (w) =>
          !w.webContents.getURL().endsWith('/pill.html') &&
          w.webContents.getURL().startsWith('vozella://'),
      )
      .some((w) => w.isMinimized()),
  );
  expect(mainMinimized).toBe(true);

  const info = await mustPill();
  expect(info.focused).toBe(false);
  expect(info.title).toBe('Live copilot');
  expect(info.alwaysOnTop).toBe(true);
  expect(info.resizable).toBe(false);
  expect(info.minimizable).toBe(false);
  expect(info.maximizable).toBe(false);
  expect(info.fullscreenable).toBe(false);
  expect(info.content.width).toBe(info.bounds.width); // frameless: no inset
  expect(info.content.height).toBe(info.bounds.height);
});

test('transparent gutter shows the backdrop, the capsule is drawn, the corners are round', async () => {
  // The started hint covers the middle of the capsule for 2.5 s: wait for it to go.
  await expect((await pillPage()).getByRole('status')).toHaveCount(0, { timeout: 6_000 });
  await sleep(300);
  const info = await mustPill();
  const b = info.bounds;
  const points = await physical([
    { x: b.x + 1, y: b.y + 1 }, // gutter, top left
    { x: b.x + b.width - 2, y: b.y + b.height - 2 }, // gutter, bottom right
    { x: b.x + GUTTER + 3, y: b.y + GUTTER + 3 }, // capsule box corner: outside the round end
    grabPoint(b), // capsule surface beside the buttons
  ]);
  const [gutterA, gutterB, corner, inside] = pixels(points);
  await snapScreenshot('pill-right.png');
  expect(gutterA).toEqual([255, 0, 255]);
  expect(gutterB).toEqual([255, 0, 255]);
  expect(corner?.[0]).toBeGreaterThan(220);
  expect(corner?.[1]).toBeLessThan(10);
  expect(inside?.[0]).toBeLessThan(80);
  expect(inside?.[2]).toBeLessThan(80);
});

test('docked at the exact work-area position, in the OS own rectangle too', async () => {
  const info = await mustPill();
  const e = expectedDock('Right');
  expect(info.bounds).toMatchObject({ x: e.x, width: e.width, height: e.height });
  // y: capsule at the middle of the free travel (round half to even, as the core does).
  const travel = wa.height - VERTICAL_LONG - 2 * MARGIN;
  expect(Math.abs(info.bounds.y - (wa.y + MARGIN + travel / 2 - GUTTER))).toBeLessThanOrEqual(1);
  const native = os('rect', info.hwnd).split(',').map(Number);
  const [origin] = await physical([{ x: info.bounds.x, y: info.bounds.y }]);
  expect(Math.abs((native[0] ?? 0) - Math.round(origin?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((native[1] ?? 0) - Math.round(origin?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((native[2] ?? 0) - Math.round(info.bounds.width * scale))).toBeLessThanOrEqual(1);
  expect(Math.abs((native[3] ?? 0) - Math.round(info.bounds.height * scale))).toBeLessThanOrEqual(
    1,
  );
});

test('opening the panel grows the window toward the center; closing restores it exactly', async () => {
  const before = (await mustPill()).bounds;
  test.skip(wa.height < 516, 'the work area is shorter than the panel');
  const page = await pillPage();
  const opened = await page.evaluate(() =>
    window.vozella.invoke('pill.setExpanded', { expanded: true }),
  );
  expect(opened.expanded).toBe(true);
  const after = await mustPill();
  // Capsule at (before.x + 8, before.y + 8); panel 380x500, gap 8; centered with truncation. At a
  // fractional scale the OS places the window on a physical pixel, so getBounds can read 1 DIP
  // off (the spike saw the same): the window is compared with a 1 DIP tolerance.
  const expected = {
    x: before.x + GUTTER + CAPSULE_SHORT - 452 - GUTTER,
    y: before.y + GUTTER - 130 - GUTTER,
    width: 452 + 2 * GUTTER,
    height: 500 + 2 * GUTTER,
  };
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after.bounds[key] - expected[key])).toBeLessThanOrEqual(1);
  }
  expect(after.content.width).toBe(after.bounds.width);
  expect(after.resizable).toBe(false);
  await snapScreenshot('pill-expanded.png');

  const closed = await page.evaluate(() =>
    window.vozella.invoke('pill.setExpanded', { expanded: false }),
  );
  expect(closed.expanded).toBe(false);
  expect((await mustPill()).bounds).toEqual(before);
});

test('a real mouse drag moves the pill and snaps it to the nearest edge, all four edges', async () => {
  const sizeBefore = (await mustPill()).bounds;
  // Right to Left: drop near the left edge, middle height.
  await dragBy(-(wa.width - 260), 0);
  await waitForPill('Left', (i) => i.bounds.x === expectedDock('Left').x);
  let b = (await mustPill()).bounds;
  expectSize(b, sizeBefore.width, sizeBefore.height);

  // Left to Top: drop near the top edge, middle width.
  const mid = wa.x + wa.width / 2;
  await dragBy(mid - center(b).x, wa.y + 60 - center(b).y);
  await waitForPill('Top', (i) => i.bounds.y === expectedDock('Top').y && i.bounds.width > 200);
  b = (await mustPill()).bounds;
  expectSize(b, expectedDock('Top').width, expectedDock('Top').height);
  // The OS move loop starts after its own drag threshold, so the drop lands a little short of
  // the target; it still lands in the middle of the top edge.
  expect(Math.abs(center(b).x - mid)).toBeLessThanOrEqual(40);
  await snapScreenshot('pill-top.png');

  // Top to Bottom.
  await dragBy(0, wa.y + wa.height - 60 - center(b).y);
  await waitForPill(
    'Bottom',
    (i) => i.bounds.y === expectedDock('Bottom').y && i.bounds.width > 200,
  );

  // Bottom to Right: drop near the right edge.
  b = (await mustPill()).bounds;
  await dragBy(wa.x + wa.width - 60 - center(b).x, wa.y + wa.height / 2 - center(b).y);
  await waitForPill('Right', (i) => i.bounds.x === expectedDock('Right').x && i.bounds.width < 200);
  b = (await mustPill()).bounds;
  expectSize(b, expectedDock('Right').width, expectedDock('Right').height);

  // The window is still the size the OS thinks it is (no drift from the native drag).
  const info = await mustPill();
  const native = os('rect', info.hwnd).split(',').map(Number);
  expect(Math.abs((native[2] ?? 0) - Math.round(info.bounds.width * scale))).toBeLessThanOrEqual(1);
  expect(Math.abs((native[3] ?? 0) - Math.round(info.bounds.height * scale))).toBeLessThanOrEqual(
    1,
  );
});

test('dragging with the panel open closes it and the capsule follows the cursor', async () => {
  test.skip(wa.height < 516, 'the work area is shorter than the panel');
  const page = await pillPage();
  await page.evaluate(() => window.vozella.invoke('pill.setExpanded', { expanded: true }));
  const opened = await mustPill();
  expect(Math.abs(opened.bounds.width - (452 + 2 * GUTTER))).toBeLessThanOrEqual(1);
  // Grab the capsule, which sits at the right end of the window, beside the buttons.
  const grab = {
    x: opened.bounds.x + opened.bounds.width - GUTTER - CAPSULE_SHORT / 2 - 18,
    y: opened.bounds.y + Math.trunc(opened.bounds.height / 2) - 28,
  };
  await dragBy(-300, 0, grab);
  await waitForPill(
    'collapsed and snapped',
    (i) => i.bounds.width < 100 && Math.abs(i.bounds.height - (VERTICAL_LONG + 2 * GUTTER)) <= 1,
  );
  const state = await page.evaluate(() => window.vozella.invoke('pill.ready', {}));
  expect(state.expanded).toBe(false);
  // It docked on the right again: the drop was 300 DIP left of the right edge, still nearest.
  expect((await mustPill()).bounds.x).toBe(expectedDock('Right').x);
});

test('the pill stays above a normal window that takes focus', async () => {
  const info = await mustPill();
  await setWork({
    x: info.bounds.x - 150,
    y: info.bounds.y + 20,
    width: 400,
    height: 200,
  });
  await focusWork();
  await sleep(700);
  const [inside] = pixels(
    await physical([{ x: info.bounds.x + GUTTER + 6, y: info.bounds.y + 80 }]),
  );
  // The capsule is dark; the work window is white.
  expect(inside?.[0]).toBeLessThan(120);
  await setWork({ x: wa.x + 300, y: wa.y + 200, width: 500, height: 300 });
});

test('pause and resume from the pill keep it up and do not hand off again', async () => {
  const page = await pillPage();
  await page.evaluate(() => window.vozella.invoke('pill.togglePause', {}));
  await expect
    .poll(() => main.evaluate(() => window.vozella.invoke('recording.getState', {})), {
      timeout: 5_000,
    })
    .toMatchObject({ isPaused: true, isRecording: true });
  expect((await mustPill()).visible).toBe(true);
  await page.evaluate(() => window.vozella.invoke('pill.togglePause', {}));
  await expect
    .poll(() => main.evaluate(() => window.vozella.invoke('recording.getState', {})), {
      timeout: 5_000,
    })
    .toMatchObject({ isPaused: false, isRecording: true });
  expect((await mustPill()).visible).toBe(true);
});

test('clicking the pill activates it so typing works', async () => {
  await focusWork();
  await sleep(300);
  const info = await mustPill();
  const [point] = await physical([grabPoint(info.bounds)]);
  if (!point) throw new Error('no point');
  os('click', Math.round(point.x), Math.round(point.y));
  await expect.poll(async () => (await mustPill()).focused, { timeout: 4_000 }).toBe(true);
});

test('bringing the main window forward hides the pill; leaving shows it again without taking focus', async () => {
  await launched.app.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    const mainWindow = BrowserWindow.getAllWindows().find(
      (w) =>
        !w.webContents.getURL().endsWith('/pill.html') &&
        w.webContents.getURL().startsWith('vozella://'),
    );
    if (!mainWindow) throw new Error('no main window');
    mainWindow.setBounds({ x: area.x + 40, y: area.y + 40, width: 700, height: 560 });
    mainWindow.restore();
    mainWindow.focus();
  });
  await waitForPill('hidden', (i) => !i.visible);
  const hidden = await mustPill();
  const [gone] = pixels(await physical([center(hidden.bounds)]));
  expect(gone).toEqual([255, 0, 255]); // the backdrop shows where the pill was

  await focusWork(); // the main window loses focus: the pill comes back
  await waitForPill('visible again', (i) => i.visible && i.bounds.x === expectedDock('Right').x);
  const back = await mustPill();
  expect(back.focused).toBe(false);
  const workFocused = await launched.app.evaluate(() => {
    const g = globalThis as unknown as { __e2e: { work: Electron.BrowserWindow } };
    return g.__e2e.work.isFocused();
  });
  expect(workFocused).toBe(true);
});

test('stopping the take hides the pill and saves the dock', async () => {
  await main.evaluate(() => window.vozella.invoke('recording.stop', {}));
  await waitForPill('hidden after stop', (i) => !i.visible, 15_000);
  const settings = JSON.parse(
    fs.readFileSync(path.join(launched.dataRoot, 'app', 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;
  const key = (name: string): unknown =>
    Object.entries(settings).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  expect(key('liveCopilotPillEdge')).toBe('Right');
  expect(typeof key('liveCopilotPillAlong')).toBe('number');
  // The provider selection written by the seed survives the dock write (bug 12).
  expect(key('selectedSummaryProvider')).toBe('Local');
});
