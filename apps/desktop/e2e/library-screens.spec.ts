import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Regenerates docs/port/screens/library-storage/*.png, the pictures T4.1 is judged from. Opt in with
// VOZELLA_SCREENSHOTS=1 so a normal run does not rewrite tracked images. With
// VOZELLA_E2E_BACKGROUND=1 the window stays off-screen and the renderer still paints real pixels.
test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
test.describe.configure({ timeout: 240_000 });

const outDir = path.resolve(__dirname, '../../../docs/port/screens/library-storage');

const UNI = '11111111-1111-4111-8111-111111111111';
const CALC = '22222222-2222-4222-8222-222222222222';
const WORK = '33333333-3333-4333-8333-333333333333';

const pad = (n: number): string => String(n).padStart(2, '0');

/** A local time some days back, with the machine's offset, so Today and Yesterday are real. */
function localStamp(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  const day = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:00.0000000${zone}`;
}

function writeFolders(libraryRoot: string): void {
  fs.mkdirSync(libraryRoot, { recursive: true });
  const entry = (
    id: string,
    name: string,
    parentId: string | null,
    colorKey: string,
    iconKey: string | null,
    note: string | null,
  ) => ({ id, name, parentId, note, colorKey, iconKey, createdAt: '2026-08-20T12:00:00-05:00' });
  fs.writeFileSync(
    path.join(libraryRoot, 'folders.json'),
    JSON.stringify(
      [
        entry(UNI, 'Universidad', null, 'teal', 'education', 'Fall term. Exams on the last week.'),
        entry(CALC, 'Calculo', UNI, 'blue', 'book', null),
        entry(WORK, 'Trabajo', null, 'amber', 'briefcase', null),
      ],
      null,
      2,
    ),
    'utf8',
  );
  for (const name of ['Universidad', 'Universidad/Calculo', 'Trabajo']) {
    fs.mkdirSync(path.join(libraryRoot, name), { recursive: true });
  }
}

const ROADMAP_SUMMARY = [
  'The team agreed to ship the September release without the calendar sync, and to move it to the first week of October.',
  '',
  'Ana owns the migration notes. Luis checks the installer on a clean machine before Friday.',
].join('\n');

const ROADMAP_TRANSCRIPT = [
  '[00:00:04] Ana: Let us start with what is left for September.',
  '[00:00:11] Luis: The installer is the only thing that worries me, the rest is done.',
  '[00:00:20] Ana: Then the calendar sync moves to October.',
].join('\n');

/** [days ago, hour, minute, length in minutes or null, title, summary]. */
const MEETINGS: readonly (readonly [number, number, number, number | null, string, string])[] = [
  [0, 10, 30, 45, 'Roadmap review', ROADMAP_SUMMARY],
  [0, 9, 0, 10, 'Standup', 'Blockers on the installer. Nothing else moved since yesterday.'],
  [0, 8, 15, 3, 'Note to self', 'Ask Luis about the code signing certificate.'],
  [1, 16, 0, 120, 'Quarterly planning', 'Budget for the fourth quarter and who covers December.'],
  [1, 11, 30, 60, 'Customer call, Acme', 'Acme asked for export to CSV and a shorter onboarding.'],
  [1, 9, 0, 12, 'Standup', 'Release branch cut. Two open bugs left on the transcript view.'],
  [
    3,
    17,
    15,
    90,
    'Reunión de tesis',
    'Revisión del capítulo dos y siguientes pasos con el asesor.',
  ],
  [
    3,
    15,
    0,
    30,
    'Design critique',
    'The list needs a calmer header. Keep the ruling, drop the pills.',
  ],
  [3, 9, 0, null, 'Hallway chat with Marta', ''],
  [
    6,
    14,
    0,
    240,
    'Workshop de arquitectura de la plataforma de pagos con el equipo de Bogotá',
    'Sesión larga sobre la separación de servicios, los límites de cada módulo y el plan de migración gradual.',
  ],
  [
    6,
    10,
    0,
    25,
    'Interview, senior designer',
    'Strong portfolio. Second round with Ana next week.',
  ],
  [8, 9, 30, 50, 'Weekly planning', 'Agreed the scope for the release and who owns each part.'],
];

function seedLibrary(dataRoot: string): void {
  const libraryRoot = path.join(dataRoot, 'meetings');
  writeFolders(libraryRoot);
  MEETINGS.forEach(([daysAgo, hour, minute, length, title, summary], index) => {
    const endTotal = hour * 60 + minute + (length ?? 0);
    const roadmap = title === 'Roadmap review';
    writeMeeting(libraryRoot, {
      id: `a${pad(index)}00000-0000-4000-8000-000000000000`,
      title,
      recordedAt: localStamp(daysAgo, hour, minute),
      ...(length === null
        ? {}
        : { endedAt: localStamp(daysAgo, Math.floor(endTotal / 60), endTotal % 60) }),
      ...(summary ? { summary } : {}),
      ...(roadmap
        ? { transcript: ROADMAP_TRANSCRIPT, attendees: ['Ana Ruiz', 'Luis Pardo', 'Marta Gil'] }
        : {}),
    });
  });
  writeMeeting(libraryRoot, {
    id: 'b1000000-0000-4000-8000-000000000000',
    title: 'Limits and continuity',
    recordedAt: localStamp(2, 8, 0),
    endedAt: localStamp(2, 9, 30),
    directory: 'Universidad/Calculo',
    folderId: CALC,
    summary: 'Epsilon-delta definitions, two worked examples and the homework for Friday.',
  });
  writeMeeting(libraryRoot, {
    id: 'b2000000-0000-4000-8000-000000000000',
    title: 'Budget sync',
    recordedAt: localStamp(4, 11, 0),
    endedAt: localStamp(4, 11, 40),
    directory: 'Trabajo',
    folderId: WORK,
    summary: 'Finance wants the numbers by the end of the month.',
  });
}

function seedThousands(dataRoot: string, count: number): void {
  const libraryRoot = path.join(dataRoot, 'meetings');
  writeFolders(libraryRoot);
  const titles = ['Standup', 'Weekly planning', 'Customer call', 'Design critique', 'One to one'];
  for (let index = 0; index < count; index += 1) {
    const daysAgo = Math.floor(index / 4);
    const hour = 8 + (index % 4) * 2;
    writeMeeting(libraryRoot, {
      id: `c${String(index).padStart(7, '0')}-0000-4000-8000-000000000000`,
      title: `${titles[index % titles.length] ?? ''} ${String(index)}`,
      recordedAt: localStamp(daysAgo, hour, 0),
      endedAt: localStamp(daysAgo, hour, 5 + ((index * 7) % 55)),
      summary: 'Who owns the next step, what was agreed and what stays open until next week.',
    });
  }
}

const inOut = (name: string): string => path.join(outDir, `${name}.png`);

/** Transitions lag in a window nobody looks at, so settle before judging any highlight. */
async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: inOut(name), animations: 'disabled' });
}

async function resize(
  launched: LaunchedApp,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(width);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width + 16);
  await page.waitForTimeout(200);
}

async function useLook(page: Page, theme: 'light' | 'dark', tag: 'en' | 'es'): Promise<void> {
  await page.evaluate(
    async ({ theme: value, tag: language }) => {
      window.localStorage.setItem('vozella.theme', value);
      await window.vozella.invoke('settings.setUiLanguage', { tag: language });
    },
    { theme, tag: tag === 'en' ? 'en-US' : 'es' },
  );
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveAttribute('lang', tag);
  await page.evaluate(() => document.fonts.ready);
}

async function openLibrary(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/library';
  });
  // The view outlives a reload, so go back to All from wherever the last test ended.
  await page.getByRole('tree').getByRole('treeitem').first().click();
  await expect(page.locator('[role="grid"] [role="row"][data-row-id]').first()).toBeVisible();
}

const row = (page: Page, title: string) =>
  page.locator('[role="row"][data-row-id]').filter({ hasText: title });

test.describe('seeded library', () => {
  let launched: LaunchedApp;
  let page: Page;

  test.beforeAll(async () => {
    launched = await launchApp({ VOZELLA_E2E_SHOW: '1' }, seedLibrary);
    page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test.afterAll(async () => {
    await launched.close();
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const tag of ['en', 'es'] as const) {
      for (const width of [960, 1180] as const) {
        test(`All in ${theme}, ${tag}, ${String(width)} wide`, async () => {
          await resize(launched, page, width, 760);
          await useLook(page, theme, tag);
          await openLibrary(page);
          await expect(row(page, 'Roadmap review').getByRole('checkbox')).toHaveCount(1);
          await shot(page, `library-all-${theme}-${tag}-${String(width)}`);
        });
      }
    }
  }

  test('checked meetings in Spanish, in the smallest window', async () => {
    await resize(launched, page, 960, 760);
    await useLook(page, 'light', 'es');
    await openLibrary(page);
    await row(page, 'Quarterly planning').getByRole('checkbox').click();
    await row(page, 'Customer call, Acme').getByRole('checkbox').click();
    await shot(page, 'library-bulk-light-es-960');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`states in ${theme}`, async () => {
      await resize(launched, page, 1180, 760);
      await useLook(page, theme, 'en');
      await openLibrary(page);

      // Search: a word only inside a summary.
      const search = page.getByRole('searchbox');
      await search.fill('installer');
      await expect(row(page, 'Standup').first()).toBeVisible();
      await expect(page.locator('mark').first()).toBeVisible();
      await shot(page, `library-search-${theme}`);
      await search.fill('zzzz');
      await expect(page.getByText('No meetings match your search.')).toBeVisible();
      await shot(page, `library-no-match-${theme}`);
      await search.fill('');

      // Hover and the row menu.
      await row(page, 'Customer call, Acme').hover();
      await shot(page, `library-row-hover-${theme}`);
      await row(page, 'Customer call, Acme').getByRole('button', { name: 'More actions' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await shot(page, `library-row-menu-${theme}`);
      await page.keyboard.press('Escape');
      // Focus left on the menu button keeps its tooltip up, and a check does not take the focus.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });

      // Several checked, with the bar up.
      await row(page, 'Quarterly planning').getByRole('checkbox').click();
      await row(page, 'Customer call, Acme').getByRole('checkbox').click();
      await row(page, 'Design critique').getByRole('checkbox').click();
      const bar = page.getByRole('toolbar', { name: 'Checked meetings' });
      await expect(bar).toBeVisible();
      await shot(page, `library-bulk-${theme}`);
      await bar.getByRole('button', { name: 'Move' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, `library-bulk-move-${theme}`);
      await page.keyboard.press('Escape');
      await bar.getByRole('button').last().click();
      await expect(bar).toHaveCount(0);

      // A folder: path, icon, note, and a move that can be undone.
      await page.getByRole('treeitem', { name: /Universidad/ }).click();
      await expect(page.getByRole('textbox', { name: 'Folder notes' })).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await page.getByRole('treeitem', { name: /Calculo/ }).click();
      await expect(row(page, 'Limits and continuity')).toBeVisible();
      await shot(page, `library-folder-${theme}`);

      await page.getByRole('treeitem', { name: /Trabajo/ }).click();
      await row(page, 'Budget sync').getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Move' }).click();
      const moveDialog = page.getByRole('dialog');
      await moveDialog.getByRole('radio', { name: /Inbox/ }).click();
      await moveDialog.getByRole('button', { name: 'Move', exact: true }).click();
      const undo = page.getByRole('button', { name: 'Undo' });
      await expect(undo).toBeVisible();
      await undo.hover();
      await shot(page, `library-undo-${theme}`);
      await undo.click();
      await expect(row(page, 'Budget sync')).toBeVisible();

      // New folder, personality and delete dialogs.
      await page.getByRole('button', { name: 'New folder' }).click();
      await expect(page.getByRole('dialog', { name: 'New folder' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Name' }).fill('Research');
      await shot(page, `library-new-folder-${theme}`);
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Folder actions' }).click();
      await page.getByRole('menuitem', { name: 'Personality' }).click();
      await expect(page.getByRole('dialog', { name: 'Folder personality' })).toBeVisible();
      await page.getByRole('radio', { name: 'purple' }).click();
      await page.getByRole('radio', { name: 'star' }).click();
      await shot(page, `library-personality-${theme}`);
      await page.keyboard.press('Escape');

      await row(page, 'Budget sync').getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await expect(page.getByRole('dialog', { name: 'Delete this meeting?' })).toBeVisible();
      await shot(page, `library-delete-${theme}`);
      await page.keyboard.press('Escape');

      await page.evaluate(() => {
        window.location.hash = '#/settings';
      });
      await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible();
      await page.getByText('Data', { exact: true }).scrollIntoViewIfNeeded();
      await shot(page, `settings-data-${theme}`);
    });

    test(`forced colors over ${theme}`, async () => {
      await resize(launched, page, 1180, 760);
      await useLook(page, theme, 'en');
      await page.emulateMedia({ forcedColors: 'active' });
      try {
        await openLibrary(page);
        await row(page, 'Quarterly planning').getByRole('checkbox').click();
        await row(page, 'Customer call, Acme').click();
        await shot(page, `library-forced-colors-${theme}`);
        await page.getByRole('searchbox').fill('an');
        await expect(page.locator('mark').first()).toBeVisible();
        await shot(page, `library-forced-colors-search-${theme}`);
        await page.getByRole('searchbox').fill('');
      } finally {
        await page.emulateMedia({ forcedColors: 'none' });
      }
    });
  }
});

test('an empty library', async () => {
  const empty = await launchApp({ VOZELLA_E2E_SHOW: '1' });
  try {
    const win = await empty.app.firstWindow();
    await expect(win.getByRole('navigation')).toBeVisible();
    await empty.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 760);
    });
    await win.evaluate(() => {
      window.location.hash = '#/library';
    });
    await expect(win.getByText('No meetings recorded yet.')).toBeVisible();
    await shot(win, 'library-empty-light');
  } finally {
    await empty.close();
  }
});

test('3,000 meetings, while loading and loaded', async () => {
  const large = await launchApp({ VOZELLA_E2E_SHOW: '1' }, (root) => {
    seedThousands(root, 3000);
  });
  try {
    const win = await large.app.firstWindow();
    await expect(win.getByRole('navigation')).toBeVisible();
    await large.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 760);
    });
    await win.evaluate(() => {
      window.location.hash = '#/library';
    });
    // The load is short: take its picture if the route is still loading when it opens.
    const loading = win.locator('[role="status"][aria-label="Loading"]').first();
    if (await loading.isVisible().catch(() => false)) {
      await win.screenshot({ path: inOut('library-loading-light') });
    }
    await expect(win.locator('[role="row"][data-row-id]').first()).toBeVisible({ timeout: 60_000 });
    await expect(win.getByTestId('library-view-count')).toHaveText('3000');
    await shot(win, 'library-3000-light');

    const grid = win.getByRole('grid', { name: 'Library' });
    await grid.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });
    await expect.poll(() => win.locator('[data-sticky="true"]').count()).toBe(1);
    await shot(win, 'library-3000-scrolled-light');
  } finally {
    await large.close();
  }
});
