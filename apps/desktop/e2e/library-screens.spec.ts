import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Regenerates docs/port/screens/library-storage/*.png. Opt in with VOZELLA_SCREENSHOTS=1 so a
// normal run does not rewrite tracked images. The window is shown, real pixels are captured.
test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
test.describe.configure({ timeout: 150_000 });

const outDir = path.resolve(__dirname, '../../../docs/port/screens/library-storage');

let launched: LaunchedApp;
let page: Page;
let libraryRoot: string;

const UNI = '11111111-1111-4111-8111-111111111111';
const CALC = '22222222-2222-4222-8222-222222222222';
const WORK = '33333333-3333-4333-8333-333333333333';

function writeFolders(): void {
  fs.mkdirSync(libraryRoot, { recursive: true });
  const entry = (
    id: string,
    name: string,
    parentId: string | null,
    colorKey: string,
    iconKey: string | null,
    note: string | null,
  ) => ({
    id,
    name,
    parentId,
    note,
    colorKey,
    iconKey,
    createdAt: '2026-08-20T12:00:00-05:00',
  });
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

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_E2E_SHOW: '1' });
  libraryRoot = path.join(launched.dataRoot, 'meetings');
  writeFolders();
  const meetings = [
    [
      'Weekly planning',
      '2026-09-03T10:30:00.0000000-05:00',
      '',
      'Agreed the scope for the September release and who owns each part.',
    ],
    [
      'Customer call, Acme',
      '2026-09-02T15:00:00.0000000-05:00',
      '',
      'Acme asked for export to CSV and a shorter onboarding.',
    ],
    ['Standup', '2026-09-01T09:00:00.0000000-05:00', '', ''],
    [
      'Reunión de tesis',
      '2026-08-29T17:15:00.0000000-05:00',
      '',
      'Revisión del capítulo dos y siguientes pasos con el asesor.',
    ],
  ] as const;
  meetings.forEach(([title, recordedAt, , summary], index) => {
    writeMeeting(libraryRoot, {
      id: `a${String(index)}000000-0000-4000-8000-000000000000`,
      title,
      recordedAt,
      ...(summary ? { summary } : {}),
    });
  });
  writeMeeting(libraryRoot, {
    id: 'b1000000-0000-4000-8000-000000000000',
    title: 'Limits and continuity',
    recordedAt: '2026-09-02T08:00:00.0000000-05:00',
    directory: 'Universidad/Calculo',
    folderId: CALC,
    summary: 'Epsilon-delta definitions, two worked examples and the homework for Friday.',
  });
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
});

test.afterAll(async () => {
  await launched.close();
});

async function useTheme(theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    window.localStorage.setItem('vozella.theme', value);
  }, theme);
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

async function resizeWindow(width: number, height: number): Promise<void> {
  await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForTimeout(300);
}

async function shot(name: string): Promise<void> {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
}

for (const theme of ['light', 'dark'] as const) {
  test(`library in ${theme}`, async () => {
    await resizeWindow(1120, 740);
    await useTheme(theme);
    await page.evaluate(() => {
      window.location.hash = '#/library';
    });
    await expect(page.getByRole('listitem').filter({ hasText: 'Weekly planning' })).toBeVisible();
    await shot(`library-inbox-${theme}`);

    await page.getByRole('treeitem', { name: /Universidad/ }).click();
    await expect(page.getByRole('textbox', { name: 'Folder notes' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('treeitem', { name: /Calculo/ }).click();
    await expect(page.getByText('Limits and continuity')).toBeVisible();
    await shot(`library-folder-${theme}`);

    await page.getByRole('searchbox').fill('zzz');
    await expect(page.getByText('No meetings match your search.')).toBeVisible();
    await shot(`library-no-match-${theme}`);
    await page.getByRole('searchbox').fill('');
    await page.getByRole('treeitem', { name: /Inbox/ }).click();

    const row = page.getByRole('listitem').filter({ hasText: 'Weekly planning' });
    await row.hover();
    await row.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await shot(`library-row-menu-${theme}`);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'New folder' }).click();
    await expect(page.getByRole('dialog', { name: 'New folder' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Name' }).fill('Research');
    await shot(`library-new-folder-${theme}`);
    await page.keyboard.press('Escape');

    await page.getByRole('treeitem', { name: /Trabajo/ }).click();
    await page.getByRole('button', { name: 'Folder actions' }).click();
    await page.getByRole('menuitem', { name: 'Personality' }).click();
    await expect(page.getByRole('dialog', { name: 'Folder personality' })).toBeVisible();
    await page.getByRole('radio', { name: 'purple' }).click();
    await page.getByRole('radio', { name: 'star' }).click();
    await shot(`library-personality-${theme}`);
    await page.keyboard.press('Escape');

    await page.getByRole('treeitem', { name: /Inbox/ }).click();
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Standup' })
      .getByRole('button', { name: 'More actions' })
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog', { name: 'Delete this meeting?' })).toBeVisible();
    await shot(`library-delete-${theme}`);
    await page.keyboard.press('Escape');

    await page.evaluate(() => {
      window.location.hash = '#/settings';
    });
    await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible();
    await page.getByText('Data', { exact: true }).scrollIntoViewIfNeeded();
    await shot(`settings-data-${theme}`);
  });
}

test('narrow window with the folder pane open', async () => {
  await useTheme('light');
  await page.evaluate(() => {
    window.location.hash = '#/library';
  });
  await resizeWindow(760, 640);
  await expect(page.getByRole('button', { name: 'Folder', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  await expect(page.getByRole('tree')).toBeVisible();
  await shot('library-narrow-pane-light');
  await resizeWindow(1120, 740);
});

test('empty library', async () => {
  const empty = await launchApp({ VOZELLA_E2E_SHOW: '1' });
  try {
    const win = await empty.app.firstWindow();
    await expect(win.getByRole('navigation')).toBeVisible();
    await win.evaluate(() => {
      window.location.hash = '#/library';
    });
    await expect(win.getByText('No meetings recorded yet.')).toBeVisible();
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(outDir, 'library-empty-light.png') });
  } finally {
    await empty.close();
  }
});
