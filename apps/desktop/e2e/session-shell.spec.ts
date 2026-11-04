import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The session page shell (header, tabs, rename, copy, open location, empty state), in the real
// app with fake native adapters and a seeded throwaway library. Screenshots go to
// docs/port/screens/session-views and are rewritten only with VOZELLA_SCREENSHOTS=1.

test.describe.configure({ timeout: 150_000, mode: 'serial' });

const WEEKLY = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const QUICK = '5b2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0f';
const LONG = '6c2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c10';

const SUMMARY = [
  '### What this was',
  '',
  'Weekly check-in on the September release, with **three decisions** and one open risk.',
  '',
  '### Key points',
  '',
  '- The build is green again after the dependency pin.',
  '- Export to CSV moves to the next sprint.',
].join('\n');

function seed(dataRoot: string): void {
  const root = path.join(dataRoot, 'meetings');
  writeMeeting(root, {
    id: WEEKLY,
    title: 'Weekly sync',
    recordedAt: '2026-09-08T09:00:00.0000000+00:00',
    transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
    summary: SUMMARY,
  });
  writeMeeting(root, {
    id: QUICK,
    title: 'Quick call',
    recordedAt: '2026-09-09T09:00:00.0000000+00:00',
  });
  writeMeeting(root, {
    id: LONG,
    title:
      'Quarterly planning review with the whole platform group about the migration schedule and staffing',
    recordedAt: '2026-09-10T09:00:00.0000000+00:00',
  });
}

function fileOf(dataRoot: string, id: string): string {
  const walk = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : entry.name.endsWith('.md')
            ? [path.join(dir, entry.name)]
            : [],
      );
  const found = walk(path.join(dataRoot, 'meetings')).find((file) =>
    fs.readFileSync(file, 'utf8').includes(`id: ${id}`),
  );
  if (!found) throw new Error(`no file for ${id}`);
  return found;
}

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp({ VOZELLA_E2E_SHOW: '1' }, seed);
  page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 780);
    // Never open a real file manager from a test; record what was asked instead.
    (globalThis as { revealed?: string[] }).revealed = [];
    shell.showItemInFolder = (file: string) => {
      (globalThis as { revealed?: string[] }).revealed?.push(file);
    };
  });
});

test.afterAll(async () => {
  await launched.close();
});

const goTo = async (name: 'Library' | 'Record'): Promise<void> => {
  await page.getByRole('navigation').getByRole('link', { name }).click();
};

const openFromWorkspace = async (id: string, tab: 'Transcript' | 'Summary'): Promise<void> => {
  await page.evaluate(
    async ({ meeting, which }) => {
      await window.vozella.invoke('workspace.dispatch', {
        action: { type: 'selectMeeting', id: meeting },
      });
      await window.vozella.invoke('workspace.dispatch', {
        action: { type: 'openSession', tab: which },
      });
    },
    { meeting: id, which: tab },
  );
  await expect(page).toHaveURL(/#\/session$/);
};

test('opens from the Library with the title, two tabs and the back link', async () => {
  await goTo('Library');
  await page
    .getByRole('button', { name: /Weekly sync/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/session$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Weekly sync' })).toBeVisible();
  const tabs = page.getByTestId('SelectorSessionTabs');
  await expect(tabs.getByRole('tab')).toHaveText(['Transcript', 'Summary']);
  await expect(page.getByTestId('BtnSessionCopy')).toBeEnabled();
  await page.getByTestId('BtnSessionBack').click();
  await expect(page).toHaveURL(/#\/library$/);
});

test('rename writes the title line of the meeting file', async () => {
  await openFromWorkspace(WEEKLY, 'Summary');
  await page.getByTestId('BtnSessionRename').click();
  const dialog = page.getByRole('dialog', { name: 'Rename meeting' });
  const input = dialog.getByRole('textbox', { name: 'Title' });
  await expect(input).toHaveValue('Weekly sync');
  await input.fill('   ');
  await expect(dialog.getByText('Enter a name to rename the meeting.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rename' })).toBeDisabled();
  await input.fill('Release planning');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Release planning' })).toBeVisible();
  // The library repository names the file from the date and title, so it moves with the rename.
  const after = fs.readFileSync(fileOf(launched.dataRoot, WEEKLY), 'utf8');
  expect(after).toContain('title: Release planning');
  expect(after).toContain(`id: ${WEEKLY}`);
});

test('copy writes the summary to the clipboard and the notice goes away by itself', async () => {
  await launched.app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await openFromWorkspace(WEEKLY, 'Summary');
  await expect(page.getByRole('heading', { name: 'Key points' })).toBeVisible();
  await page.getByTestId('BtnSessionCopy').click();
  await expect(page.getByTestId('InfoSessionCopy')).toBeVisible();
  const text = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
  expect(text).toContain('Key points');
  await expect(page.getByTestId('InfoSessionCopy')).toBeHidden({ timeout: 6000 });
});

test('the chosen tab is remembered for the next meeting', async () => {
  await openFromWorkspace(WEEKLY, 'Summary');
  await page.getByRole('tab', { name: 'Transcript' }).click();
  await expect(page.getByRole('tab', { name: 'Transcript' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await openFromWorkspaceKeepingTab(QUICK);
  await expect(page.getByRole('heading', { level: 1, name: 'Quick call' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Transcript' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Summary' }).click();
  await openFromWorkspaceKeepingTab(WEEKLY);
  await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
});

async function openFromWorkspaceKeepingTab(id: string): Promise<void> {
  await page.evaluate(async (meeting) => {
    await window.vozella.invoke('workspace.dispatch', {
      action: { type: 'selectMeeting', id: meeting },
    });
  }, id);
}

test('open file location asks the shell to reveal the meeting file', async () => {
  await openFromWorkspace(WEEKLY, 'Summary');
  await page.getByTestId('BtnSessionOpenLocation').click();
  await expect
    .poll(() => launched.app.evaluate(() => (globalThis as { revealed?: string[] }).revealed))
    .toEqual([fileOf(launched.dataRoot, WEEKLY)]);
  await expect(page.getByText('Could not open the file location.')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('a meeting that is deleted while open leaves the empty state', async () => {
  await openFromWorkspace(QUICK, 'Transcript');
  await expect(page.getByRole('heading', { level: 1, name: 'Quick call' })).toBeVisible();
  await page.evaluate(
    (id) => window.vozella.invoke('library.deleteMeeting', { meetingId: id }),
    QUICK,
  );
  await expect(page.getByText('Open a meeting from Library, or record one.')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.getByTestId('BtnSessionEmptyRecord').click();
  await expect(page).toHaveURL(/#\/record$/);
});

test.describe('screenshots', () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  const outDir = path.resolve(__dirname, '../../../docs/port/screens/session-views');

  const shot = async (name: string): Promise<void> => {
    await page.waitForTimeout(350);
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };

  const useTheme = async (theme: 'light' | 'dark'): Promise<void> => {
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
  };

  for (const theme of ['light', 'dark'] as const) {
    test(`session shell in ${theme}`, async () => {
      await useTheme(theme);
      await openFromWorkspace(WEEKLY, 'Summary');
      await expect(page.getByRole('heading', { name: 'Key points' })).toBeVisible();
      await page.getByTestId('BtnSessionCopy').click();
      await expect(page.getByTestId('InfoSessionCopy')).toBeVisible();
      await shot(`summary-copied-${theme}`);
      await openFromWorkspace(LONG, 'Transcript');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(`long-title-${theme}`);
      await page.getByTestId('BtnSessionRename').click();
      await page.getByRole('dialog').getByRole('textbox').fill('');
      await shot(`rename-blank-${theme}`);
      await page.keyboard.press('Escape');
      await page.evaluate(async () => {
        await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'selectMeeting', id: null },
        });
      });
      await expect(page.getByTestId('BtnSessionEmptyRecord')).toBeVisible();
      await shot(`empty-${theme}`);
    });
  }
});
