import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The Summary tab of the session page, in the real app with fake native adapters and a seeded
// throwaway library. Files on disk are the truth: ticks and notes are read back from them.
// Screenshots (docs/port/screens/summaries) are rewritten only with VOZELLA_SCREENSHOTS=1.

test.describe.configure({ timeout: 150_000 });

const WEEKLY = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const WEEKLY_EARLIER = '4a2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0e';
const BLANK = '5b2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0f';

const SUMMARY = [
  '### What this was',
  '',
  'Weekly check-in on the September release, with **three decisions** and one open risk.',
  '',
  '### Key points',
  '',
  '- The build is green again after the dependency pin.',
  '- Support wants a dated changelog before the release.',
  '- Export to CSV moves to the next sprint.',
  '',
  '### Decisions',
  '',
  '1. Ship on Friday, 11 September.',
  '2. Freeze the scope on Wednesday.',
  '',
  '### Open questions',
  '',
  'Who tells the customer about the delayed export? See the [release plan](https://example.com/plan).',
].join('\n');

const ACTIONS = [
  '- [ ] Send the release notes to support',
  '- [x] Pin the dependency version',
  '- [ ] Book the review room for Wednesday',
];

function seed(dataRoot: string): void {
  const root = path.join(dataRoot, 'meetings');
  const main = writeMeeting(root, {
    id: WEEKLY,
    title: 'Weekly sync',
    recordedAt: '2026-09-08T09:00:00.0000000+00:00',
    transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
    summary: SUMMARY,
  });
  fs.appendFileSync(main, ['', '## Action Items', '', ...ACTIONS, ''].join('\n'), 'utf8');
  writeMeeting(root, {
    id: WEEKLY_EARLIER,
    title: 'Weekly sync',
    recordedAt: '2026-09-01T09:00:00.0000000+00:00',
    summary: 'Kick-off for the September release.',
  });
  writeMeeting(root, {
    id: BLANK,
    title: 'Quick call',
    recordedAt: '2026-09-09T09:00:00.0000000+00:00',
  });
}

/** The markdown file that holds a meeting, found by its id. */
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
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 780);
  });
});

test.afterAll(async () => {
  await launched.close();
});

const openSummary = async (id: string): Promise<void> => {
  await page.evaluate(async (meeting) => {
    await window.vozella.invoke('workspace.dispatch', {
      action: { type: 'selectMeeting', id: meeting },
    });
    await window.vozella.invoke('workspace.dispatch', {
      action: { type: 'openSession', tab: 'Summary' },
    });
  }, id);
  await expect(page).toHaveURL(/#\/session$/);
};

test('an empty meeting shows the empty state, and its call to action opens Record', async () => {
  await openSummary(BLANK);
  await expect(page.getByRole('heading', { level: 1, name: 'Quick call' })).toBeVisible();
  await expect(page.getByText(/There's no summary yet/)).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Enhanced' })).toBeChecked();
  await page.getByRole('button', { name: 'Record a meeting' }).click();
  await expect(page).toHaveURL(/#\/record$/);
});

test('the summary reads as a document with action items below it', async () => {
  await openSummary(WEEKLY);
  const content = page.getByTestId('TxtSummaryContent');
  await expect(content.getByRole('heading', { name: 'Key points' })).toBeVisible();
  await expect(content.getByRole('listitem')).toHaveCount(5);
  await expect(content.locator('strong')).toHaveText('three decisions');
  await expect(content.getByRole('link', { name: 'release plan' })).toHaveAttribute(
    'href',
    'https://example.com/plan',
  );
  await expect(page.getByRole('heading', { name: 'Action items' })).toBeVisible();
  const list = page.getByTestId('ListActionItems');
  await expect(list.getByRole('checkbox')).toHaveCount(3);
  await expect(list.getByRole('checkbox', { name: 'Pin the dependency version' })).toBeChecked();
});

test('ticking an action item is written to the file', async () => {
  await openSummary(WEEKLY);
  const box = page
    .getByTestId('ListActionItems')
    .getByRole('checkbox', { name: 'Send the release notes to support' });
  await box.click();
  await expect(box).toBeChecked();
  await expect
    .poll(() => fs.readFileSync(fileOf(launched.dataRoot, WEEKLY), 'utf8'))
    .toContain('- [x] Send the release notes to support');
  const text = fs.readFileSync(fileOf(launched.dataRoot, WEEKLY), 'utf8');
  expect(text).toContain('- [x] Pin the dependency version');
  expect(text).toContain('- [ ] Book the review room for Wednesday');
  expect(text).toContain('## Summary');

  await box.click();
  await expect
    .poll(() => fs.readFileSync(fileOf(launched.dataRoot, WEEKLY), 'utf8'))
    .toContain('- [ ] Send the release notes to support');
});

test('my notes: typed text is saved on blur and kept when switching back', async () => {
  await openSummary(WEEKLY);
  const switchBar = page.getByRole('radiogroup', { name: 'Summary' });
  await switchBar.getByRole('radio', { name: 'My notes' }).click();
  await expect(page.getByTestId('TxtSummaryContent')).toBeHidden();
  const notes = page.getByRole('textbox', { name: 'Your notes' });
  await expect(notes).toHaveAttribute('placeholder', 'Add your notes for this meeting');
  await notes.fill('Ask finance about the budget line');
  await page.getByRole('heading', { level: 1, name: 'Weekly sync' }).click();
  await expect
    .poll(() => fs.readFileSync(fileOf(launched.dataRoot, WEEKLY), 'utf8'))
    .toContain('Ask finance about the budget line');
  // Typed again and left with the switch alone: no blur on the box first.
  await notes.fill('Ask finance about the budget line, then the vendor');
  await switchBar.getByRole('radio', { name: 'Enhanced' }).click();
  await expect(page.getByTestId('TxtSummaryContent')).toBeVisible();
  await expect
    .poll(() => fs.readFileSync(fileOf(launched.dataRoot, WEEKLY), 'utf8'))
    .toContain('then the vendor');
  const text = fs.readFileSync(fileOf(launched.dataRoot, WEEKLY), 'utf8');
  expect(text).toContain('Weekly check-in on the September release');
  expect(text).toContain('we ship on Friday');
});

test('a related meeting opens on its own Summary tab', async () => {
  await openSummary(WEEKLY);
  const related = page.getByRole('navigation', { name: 'Related meetings' });
  await expect(related.getByRole('button')).toHaveCount(1);
  await related.getByRole('button', { name: /Weekly sync/ }).click();
  await expect(page.getByText('Kick-off for the September release.')).toBeVisible();
  const state = await page.evaluate(() => window.vozella.invoke('workspace.getState', {}));
  expect(state).toMatchObject({ selectedMeetingId: WEEKLY_EARLIER, sessionTab: 'Summary' });
  await expect(page.getByRole('navigation', { name: 'Related meetings' })).toBeVisible();
});

test('the mode switch works from the keyboard', async () => {
  await openSummary(WEEKLY);
  await page.getByRole('radio', { name: 'Enhanced' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'My notes' })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Your notes' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Enhanced' })).toBeChecked();
});

test('in Spanish the tab uses the Spanish strings', async () => {
  await openSummary(WEEKLY);
  await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
  await expect(page.getByRole('radio', { name: 'Mis notas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elementos de acción' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Reuniones relacionadas' })).toBeVisible();
  await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'en-US' }));
  await expect(page.getByRole('radio', { name: 'My notes' })).toBeVisible();
});

test('no serious accessibility violations in light and dark', async () => {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await openSummary(WEEKLY);
    await expect(page.getByTestId('ListActionItems')).toBeVisible();
    // AxeBuilder opens a second page, which Electron does not support: inject axe directly.
    await page.evaluate(axe.source);
    for (const mode of ['Enhanced', 'My notes']) {
      await page.getByRole('radio', { name: mode }).click();
      const results = await page.evaluate(() =>
        (window as unknown as { axe: typeof axe }).axe.run(document),
      );
      const serious = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(
        serious.map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
        })),
      ).toEqual([]);
    }
  }
});

test.describe('screenshots', () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  const outDir = path.resolve(__dirname, '../../../docs/port/screens/summaries');

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
    test(`summary tab in ${theme}`, async () => {
      await useTheme(theme);
      await openSummary(WEEKLY);
      await expect(page.getByTestId('ListActionItems')).toBeVisible();
      await shot(`summary-${theme}`);
      await page.getByRole('radio', { name: 'My notes' }).click();
      await page
        .getByRole('textbox', { name: 'Your notes' })
        .fill('Ask finance about the budget line');
      await shot(`notes-${theme}`);
      await page.getByRole('radio', { name: 'Enhanced' }).click();
      await openSummary(BLANK);
      await expect(page.getByText(/There's no summary yet/)).toBeVisible();
      await shot(`empty-${theme}`);
    });
  }

  test('summary tab in Spanish', async () => {
    await useTheme('light');
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
    await openSummary(WEEKLY);
    await expect(page.getByRole('heading', { name: 'Elementos de acción' })).toBeVisible();
    await shot('summary-es');
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'en-US' }));
  });
});
