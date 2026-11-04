import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installEngine, launchApp, readyEnv, type LaunchedApp } from './launch';
import { os, pixels, sleep } from './os/os';

// The chat panel of the pill window (spec 2.8) on the fake native build: a fake take, the panel
// growing toward the screen center, asks through the chips and the typed box against the fake
// summary provider (no real CLI, no real account), the web badge, the error path, collapse on
// drag and close on stop. The panel surface, its 28 DIP corner and the transparent gutter are
// measured on real composed screen pixels over a magenta backdrop, as the window spike did.
// Screenshots (VOZELLA_SCREENSHOTS=1) go to docs/port/screens/live-copilot. Windows only.

const outDir = path.resolve(__dirname, '../../../docs/port/screens/live-copilot');
const shots = process.env.VOZELLA_SCREENSHOTS === '1';
const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';
const ANSWER = 'The team went over the plan';

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

const seedClaude = (root: string): void => {
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app', 'settings.json'),
    JSON.stringify({ selectedSummaryProvider: 'ClaudeCode', selectedSummaryModelId: MODEL }),
  );
};

const findPill = (app: LaunchedApp['app']) =>
  app.windows().find((p) => p.url().endsWith('/pill.html'));

async function pillBounds(app = launched.app): Promise<Rect> {
  const bounds = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().endsWith('/pill.html'),
    );
    return w ? w.getBounds() : null;
  });
  if (!bounds) throw new Error('the pill window does not exist');
  return bounds;
}

async function pillPage(app = launched.app): Promise<Page> {
  await expect.poll(() => findPill(app) !== undefined, { timeout: 15_000 }).toBe(true);
  const found = findPill(app);
  if (!found) throw new Error('no pill page');
  return found;
}

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

// Dark tokens: paper-raised #171717 is the surface.
const SURFACE = [23, 23, 23];

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

async function startTake(page: Page, title: string): Promise<void> {
  const start = await page.evaluate(
    (t) =>
      window.vozella.invoke('recording.start', {
        title: t,
        folderId: null,
        microphone: null,
        appName: null,
      }),
    title,
  );
  expect(start).toMatchObject({ started: true });
}

/** Opens the panel with the chat button and waits for the window to finish growing. */
async function expand(page: Page): Promise<void> {
  // The started hint and the entrance fade end first; a click before then is lost.
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10_000 });
  await page.locator('#BtnLiveCopilotChat').click();
  await expect(page.locator('#BtnLiveCopilotChat')).toHaveAttribute('aria-expanded', 'true');
  await waitSettled((r) => r.width > 400);
  await expect(page.getByTestId('LiveCopilotPanel')).toBeVisible();
  await raiseBackdrop();
  await sleep(350);
}

async function raiseBackdrop(): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }) => {
    const backdrop = (globalThis as { __backdrop?: Electron.BrowserWindow }).__backdrop;
    backdrop?.setAlwaysOnTop(true, 'normal');
    backdrop?.moveTop();
    BrowserWindow.getAllWindows()
      .find((x) => x.webContents.getURL().endsWith('/pill.html'))
      ?.moveTop();
  });
  await sleep(300);
}

test.beforeAll(async () => {
  launched = await launchApp(
    { ...readyEnv, VOZELLA_E2E_SHOW: '1', VOZELLA_FAKE_SUMMARY_DELAY_MS: '500' },
    seedClaude,
  );
  main = await launched.app.firstWindow();
  await expect(main.getByRole('navigation')).toBeVisible();
  await main.getByRole('link', { name: 'Record' }).click();
  await installEngine(main);
  const info = await launched.app.evaluate(({ screen }) => ({
    wa: screen.getPrimaryDisplay().workArea,
    scale: screen.getPrimaryDisplay().scaleFactor,
  }));
  wa = info.wa;
  scale = info.scale;
  test.skip(wa.height < 516, 'the work area is shorter than the panel');
  await launched.app.evaluate(({ BrowserWindow }, area) => {
    const backdrop = new BrowserWindow({
      ...area,
      frame: false,
      backgroundColor: '#ff00ff',
      show: true,
      focusable: false,
      skipTaskbar: true,
    });
    backdrop.setIgnoreMouseEvents(true);
    (globalThis as { __backdrop?: Electron.BrowserWindow }).__backdrop = backdrop;
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
  await startTake(main, 'Panel e2e');
  // Handing off minimizes the app and the OS raises whatever was behind it: put the backdrop back
  // above every normal window. The pill is topmost, so it stays above the backdrop.
  await pillPage();
  await sleep(1500);
  await raiseBackdrop();
});

test.afterAll(async () => {
  await main.evaluate(() => window.vozella.invoke('recording.discard', {})).catch(() => undefined);
  // The stopped take may still be processing, which the close protection would wait for.
  await launched.app
    .evaluate(({ app }) => {
      app.exit(0);
    })
    .catch(() => undefined);
  await sleep(1000);
  await launched.close().catch(() => undefined);
});

test('expanding grows the window toward the screen center and keeps the capsule where it was', async () => {
  const page = await pillPage();
  await expect(page.getByTestId('LiveCopilotPanel')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 10_000 });
  await sleep(500);
  const before = await boxOf('#LiveCopilotCapsule');
  const windowBefore = await pillBounds();
  await expand(page);
  const after = await boxOf('#LiveCopilotCapsule');
  const windowAfter = await pillBounds();

  // Docked right: the window grows to the left, its right edge stays.
  expect(windowAfter.x + windowAfter.width).toBe(windowBefore.x + windowBefore.width);
  expect(windowAfter.x).toBeLessThan(windowBefore.x);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  const panel = await boxOf('[data-testid="pill-panel"]');
  expect(Math.round(panel.width)).toBe(380);
  expect(Math.round(panel.height)).toBe(500);
  expect(panel.x + panel.width).toBeLessThanOrEqual(after.x);

  // The five rows are all there, the question card is not.
  for (const id of [
    'TxtLiveCopilotTitle',
    'BtnLiveCopilotOpenApp',
    'LiveCopilotAnswerArea',
    'BtnLiveCopilotChipMissed',
    'BtnLiveCopilotChipExplain',
    'TxtLiveCopilotAsk',
    'ToggleLiveCopilotWeb',
    'BtnLiveCopilotSend',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('InfoLiveCopilotQuestion')).toHaveCount(0);
  await expect(page.getByTestId('TxtLiveCopilotEmpty')).toHaveText('Ask a question below.');
});

test('pixels: panel surface, 28 DIP corner and the transparent gutter', async () => {
  const b = await pillBounds();
  const panel = await boxOf('[data-testid="pill-panel"]');
  await snap('panel-empty-dark.png');

  // Gutter: the window corner shows the backdrop, only the soft shadow may touch it.
  const [gutter] = await pixelsAt([{ x: b.x + 1, y: b.y + 1 }]);
  expect(isMagenta(gutter)).toBe(true);
  expect(gutter?.[0]).toBeGreaterThan(240);

  // The panel box corner is outside a 28 radius; 11 DIP in along the diagonal is inside it.
  const [outside, inside, middle] = await pixelsAt([
    { x: panel.x + 3, y: panel.y + 3 },
    { x: panel.x + 11, y: panel.y + 11 },
    { x: panel.x + 6, y: panel.y + panel.height / 2 },
  ]);
  expect(isMagenta(outside)).toBe(true);
  expect(near(inside, SURFACE, 3)).toBe(true);
  expect(near(middle, SURFACE, 3)).toBe(true);
  // The bottom right corner of the panel rounds too.
  const [bottomRight] = await pixelsAt([
    { x: panel.x + panel.width - 3, y: panel.y + panel.height - 3 },
  ]);
  expect(isMagenta(bottomRight)).toBe(true);
});

test('a preset chip asks, shows the progress ring, then the streamed answer', async () => {
  const page = await pillPage();
  await expect(page.getByTestId('ToggleLiveCopilotWeb')).toBeDisabled();
  await page.getByTestId('BtnLiveCopilotChipMissed').click();
  await expect(page.getByRole('progressbar', { name: 'Answering' })).toBeVisible();
  await expect(page.getByTestId('TxtLiveCopilotEmpty')).toHaveCount(0);
  await expect(page.getByTestId('MdLiveCopilotAnswer')).toContainText(ANSWER, { timeout: 30_000 });
  await expect(page.getByRole('progressbar', { name: 'Answering' })).toHaveCount(0);
  await expect(page.getByTestId('BadgeLiveCopilotWeb')).toHaveCount(0);
  // The provider can search the web now that an ask has reached it.
  await expect(page.getByTestId('ToggleLiveCopilotWeb')).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByTestId('ToggleLiveCopilotWeb')).toHaveAttribute(
    'title',
    'Search the web for the answer',
  );
  await snap('panel-answer-dark.png');
});

test('a typed question sends on Ctrl+Enter only, then clears the box', async () => {
  const page = await pillPage();
  const box = page.getByRole('textbox', { name: 'Type a question' });
  await box.fill('Who owns the next step?');
  await box.press('Enter');
  await expect(page.getByRole('progressbar', { name: 'Answering' })).toHaveCount(0);
  // Ctrl+Enter on another element does nothing.
  await page.getByTestId('LiveCopilotAnswerArea').focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('progressbar', { name: 'Answering' })).toHaveCount(0);
  await expect(box).toHaveValue('Who owns the next step?');

  await box.press('Control+Enter');
  await expect(page.getByRole('progressbar', { name: 'Answering' })).toBeVisible();
  await expect(box).toHaveValue('');
  await expect(page.getByTestId('MdLiveCopilotAnswer')).toContainText(ANSWER, { timeout: 30_000 });
});

test('the web toggle adds the badge to the answer and survives the next ask', async () => {
  const page = await pillPage();
  const toggle = page.getByTestId('ToggleLiveCopilotWeb');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const box = page.getByRole('textbox', { name: 'Type a question' });
  await box.fill('What is the latest on this?');
  await page.getByTestId('BtnLiveCopilotSend').click();
  await expect(page.getByTestId('BadgeLiveCopilotWeb')).toHaveText('Searched the web', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('MdLiveCopilotAnswer')).toContainText(ANSWER);
  await sleep(200);
  await snap('panel-web-dark.png');
  await setAppTheme('light');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await snap('panel-web-app-light.png');
  await setAppTheme('dark');
});

const mainMinimized = (): Promise<boolean | null> =>
  launched.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().includes('index.html'),
    );
    return w ? w.isMinimized() : null;
  });

const pillVisible = (): Promise<boolean> =>
  launched.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) =>
      x.webContents.getURL().endsWith('/pill.html'),
    );
    return w ? w.isVisible() : false;
  });

/** The pill shows while the app is not in front: minimize the app and put the backdrop back. */
async function minimizeApp(): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((x) => x.webContents.getURL().includes('index.html'))
      ?.minimize();
  });
  await expect.poll(mainMinimized).toBe(true);
  await expect.poll(pillVisible, { timeout: 10_000 }).toBe(true);
  await sleep(600);
  await raiseBackdrop();
}

test('dragging the capsule collapses the panel at once', async () => {
  const page = await pillPage();
  await expect(page.getByTestId('LiveCopilotPanel')).toBeVisible();
  const cap = await boxOf('#LiveCopilotCapsule');
  // Beside the middle buttons, as the window spec grabs it.
  const from = { x: cap.x + cap.width / 2 - 18, y: cap.y + cap.height / 2 - 28 };
  const to = { x: from.x - 300, y: from.y };
  const [a, z] = await physical([from, to]);
  if (!a || !z) throw new Error('no points');
  os('drag2', Math.round(a.x), Math.round(a.y), Math.round(z.x), Math.round(z.y));
  await expect(page.getByTestId('LiveCopilotPanel')).toHaveCount(0, { timeout: 5_000 });
  await waitSettled((r) => r.width < 100);
  await expect(page.locator('#BtnLiveCopilotChat')).toHaveAttribute('aria-expanded', 'false');
});

test('the panel reopens with the last answer and its web badge', async () => {
  const page = await pillPage();
  await expand(page);
  await expect(page.getByTestId('MdLiveCopilotAnswer')).toContainText(ANSWER);
  await expect(page.getByTestId('BadgeLiveCopilotWeb')).toBeVisible();
});

test('the header button restores a minimized main window and focuses it', async () => {
  await minimizeApp();
  const page = await pillPage();
  await page.getByTestId('BtnLiveCopilotOpenApp').click();
  await expect.poll(mainMinimized).toBe(false);
});

test('the panel closes with the pill when the take stops', async () => {
  await minimizeApp();
  const page = await pillPage();
  await expect(page.getByTestId('LiveCopilotPanel')).toBeVisible();
  await main.evaluate(() => window.vozella.invoke('recording.stop', {})).catch(() => undefined);
  await expect.poll(pillVisible, { timeout: 15_000 }).toBe(false);
  await expect(page.getByTestId('LiveCopilotPanel')).toHaveCount(0);
});
