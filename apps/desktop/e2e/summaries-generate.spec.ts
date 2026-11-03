import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Generate, regenerate, cancel, templates, status and copy on the Summary tab, in the real app
// with the fake native build: the FakeSummaryProvider answers for every engine, with a delay and
// a failure that the environment controls. Files on disk are the truth.
// Screenshots (docs/port/screens/summaries) are rewritten only with VOZELLA_SCREENSHOTS=1.

test.describe.configure({ timeout: 150_000 });

const FRESH = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const DONE = '4a2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0e';
const NO_ITEMS = '5b2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0f';

const TRANSCRIPT = '[00:00.00-00:05.00] Ana: we ship on Friday\n[00:05.00-00:09.00] Leo: agreed';

function seed(dataRoot: string): void {
  const root = path.join(dataRoot, 'meetings');
  writeMeeting(root, {
    id: FRESH,
    title: 'Planning call',
    recordedAt: '2026-09-08T09:00:00.0000000+00:00',
    transcript: TRANSCRIPT,
  });
  const done = writeMeeting(root, {
    id: DONE,
    title: 'Weekly sync',
    recordedAt: '2026-09-01T09:00:00.0000000+00:00',
    transcript: TRANSCRIPT,
    summary: '### Key points\n\n- The build is green again.\n- Export moves to the next sprint.',
  });
  fs.appendFileSync(
    done,
    [
      '',
      '## Action Items',
      '',
      '- [ ] Send the release notes',
      '- [x] Pin the dependency',
      '',
    ].join('\n'),
    'utf8',
  );
  writeMeeting(root, {
    id: NO_ITEMS,
    title: 'Quick sync',
    recordedAt: '2026-09-09T09:00:00.0000000+00:00',
    transcript: TRANSCRIPT,
    summary: 'A short call with nothing to follow up.',
  });
}

const fileOf = (dataRoot: string, id: string): string => {
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
};

interface Session {
  readonly launched: LaunchedApp;
  readonly page: Page;
  readonly read: (id: string) => string;
  readonly open: (id: string) => Promise<void>;
}

/** Launches the app with an engine chosen, so the gate is ready and runs reach the fake provider. */
async function start(env: Record<string, string> = {}): Promise<Session> {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1', ...env }, seed);
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 780);
  });
  await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
  return {
    launched,
    page,
    read: (id) => fs.readFileSync(fileOf(launched.dataRoot, id), 'utf8'),
    open: async (id) => {
      await page.evaluate(async (meeting) => {
        await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'selectMeeting', id: meeting },
        });
        await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'openSession', tab: 'Summary' },
        });
      }, id);
      await expect(page).toHaveURL(/#\/session$/);
    },
  };
}

test.describe('with the default fake provider', () => {
  let session: Session;
  test.beforeAll(async () => {
    session = await start();
  });
  test.afterAll(async () => {
    await session.launched.close();
  });

  test('generate shows the status, then the summary and checklist, and writes the file', async () => {
    const { page, read, open } = session;
    await open(FRESH);
    await expect(page.getByTestId('BtnGenerateSummary')).toBeVisible();
    await expect(page.getByTestId('BtnRegenerateSummary')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Note template' }).click();
    await page.getByRole('option', { name: 'Standup' }).click();
    await page.getByTestId('BtnGenerateSummary').click();

    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Summary generated.');
    await expect(page.getByTestId('TxtSummaryContent')).toContainText(
      'The team went over the plan and agreed on the next steps.',
    );
    const list = page.getByTestId('ListActionItems');
    await expect(list.getByRole('checkbox', { name: 'Send the notes to the team' })).toBeVisible();
    await expect(list.getByRole('checkbox', { name: 'Book the follow-up call' })).toBeVisible();
    await expect(page.getByTestId('BtnRegenerateSummary')).toBeVisible();
    await expect(page.getByTestId('BtnGenerateSummary')).toHaveCount(0);

    const text = read(FRESH);
    expect(text).toContain('summaryProvider: claude-code');
    expect(text).toContain('noteTemplateId: standup');
    expect(text).toContain('The team went over the plan');
    expect(text).toContain('- [ ] Book the follow-up call');
    expect(text).toContain('we ship on Friday');
    // The auto title "Planning call" is a name the user may have chosen: it is kept.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the template survives a regenerate and the picker shows the saved one after a reload', async () => {
    const { page, read, open } = session;
    await open(FRESH);
    const picker = page.getByRole('combobox', { name: 'Note template' });
    await expect(picker).toHaveText(/Standup/);
    await page.getByTestId('BtnRegenerateSummary').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Regenerate' }).click();
    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Summary generated.');
    expect(read(FRESH)).toContain('noteTemplateId: standup');
    await page.reload();
    await open(FRESH);
    await expect(page.getByRole('combobox', { name: 'Note template' })).toHaveText(/Standup/);
    // Picking Auto and regenerating clears the stored template.
    await page.getByRole('combobox', { name: 'Note template' }).click();
    await page.getByRole('option', { name: 'Auto' }).click();
    await page.getByTestId('BtnRegenerateSummary').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Regenerate' }).click();
    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Summary generated.');
    expect(read(FRESH)).not.toContain('noteTemplateId');
  });

  test('regenerate asks first: cancel keeps the summary, confirm replaces it', async () => {
    const { page, read, open } = session;
    await open(DONE);
    const before = read(DONE);
    await page.getByTestId('BtnRegenerateSummary').click();
    const dialog = page.getByRole('dialog', { name: 'Replace this summary?' });
    await expect(dialog).toContainText(
      'Regenerating will overwrite the summary and action items for "Weekly sync".',
    );
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(read(DONE)).toBe(before);
    await expect(page.getByTestId('TxtSummaryContent')).toContainText('The build is green again.');

    await page.getByTestId('BtnRegenerateSummary').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Regenerate' }).click();
    await expect(page.getByTestId('TxtSummaryContent')).toContainText(
      'The team went over the plan',
    );
    await expect(page.getByTestId('ListActionItems').getByRole('checkbox')).toHaveCount(2);
    expect(read(DONE)).not.toContain('The build is green again.');
  });

  test('copy action items puts the list on the clipboard with a plain message', async () => {
    const { page, launched, open } = session;
    await open(DONE);
    await page.getByRole('button', { name: 'More options' }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(1);
    await page.getByRole('menuitem', { name: 'Copy action items' }).click();
    const message = page.getByTestId('DraftMessage');
    await expect(message).toContainText('Action items copied to the clipboard.');
    await expect(page.getByText('Could not create the draft')).toHaveCount(0);
    const clip = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
    expect(clip).toBe('- [ ] Send the notes to the team\n- [ ] Book the follow-up call');
    // It goes away by itself.
    await expect(message).toBeHidden({ timeout: 8000 });
  });

  test('a summary with no action items says so and copies nothing', async () => {
    const { page, launched, open } = session;
    await launched.app.evaluate(({ clipboard }) => clipboard.writeText('unchanged'));
    await open(NO_ITEMS);
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitem', { name: 'Copy action items' }).click();
    await expect(page.getByTestId('DraftMessage')).toContainText('No action items to copy.');
    expect(await launched.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('unchanged');
  });
});

test('a failed run shows the localized failure and the action stays available', async () => {
  const session = await start({ VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' });
  try {
    const { page, read, open } = session;
    await open(FRESH);
    const before = read(FRESH);
    await page.getByTestId('BtnGenerateSummary').click();
    const status = page.getByTestId('TxtSummaryStatus');
    await expect(status).toContainText('Error generating the summary: ');
    await expect(status).toContainText(/sign/i);
    await expect(page.getByTestId('BtnGenerateSummary')).toBeEnabled();
    expect(read(FRESH)).toBe(before);

    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
    await expect(page.getByTestId('BtnGenerateSummary')).toHaveText('Generar resumen');
    await page.getByTestId('BtnGenerateSummary').click();
    await expect(status).toContainText('Error al generar el resumen: ');
  } finally {
    await session.launched.close();
  }
});

test('cancel mid-run keeps the previous summary and shows a quiet cancelled line', async () => {
  const session = await start({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '15000' });
  try {
    const { page, read, open } = session;
    await open(DONE);
    const before = read(DONE);
    await page.getByTestId('BtnRegenerateSummary').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Regenerate' }).click();
    const status = page.getByTestId('TxtSummaryStatus');
    await expect(status).toContainText('Generating summary...');
    await expect(page.getByTestId('BtnRegenerateSummary')).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Note template' })).toBeDisabled();
    await page.getByRole('button', { name: 'More options' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy action items' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.keyboard.press('Escape');
    await page.getByTestId('BtnCancelSummary').click();
    await expect(status).toContainText('Summary cancelled.');
    await expect(page.getByTestId('BtnRegenerateSummary')).toBeEnabled();
    await expect(page.getByTestId('BtnCancelSummary')).toHaveCount(0);
    await expect(page.getByTestId('TxtSummaryContent')).toContainText('The build is green again.');
    expect(read(DONE)).toBe(before);
  } finally {
    await session.launched.close();
  }
});

test('a page opened during a run shows it, and the run finishing reloads the tab', async () => {
  const session = await start({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '2500' });
  try {
    const { page, open } = session;
    await open(FRESH);
    void page.evaluate(() =>
      window.vozella.invoke('summaries.generate', {
        meetingId: '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d',
        regenerate: false,
      }),
    );
    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Generating summary...');
    await expect(page.getByTestId('BtnGenerateSummary')).toBeDisabled();
    await expect(page.getByTestId('TxtSummaryContent')).toContainText('The team went over');
    await expect(page.getByTestId('BtnRegenerateSummary')).toBeEnabled();
  } finally {
    await session.launched.close();
  }
});

test('with no engine set up the run ends as setup cancelled and the file is untouched', async () => {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1' }, seed);
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.evaluate(async (id) => {
      await window.vozella.invoke('workspace.dispatch', {
        action: { type: 'selectMeeting', id },
      });
      await window.vozella.invoke('workspace.dispatch', {
        action: { type: 'openSession', tab: 'Summary' },
      });
    }, FRESH);
    await expect(page).toHaveURL(/#\/session$/);
    await expect(page.getByTestId('BtnGenerateSummary')).toBeVisible();
    const before = fs.readFileSync(fileOf(launched.dataRoot, FRESH), 'utf8');
    await page.getByTestId('BtnGenerateSummary').click();
    // The Local engine has no model, so the wizard opens on the model step; leaving it cancels.
    const wizard = page.getByRole('dialog', { name: 'Set up summary generation' });
    await expect(wizard.getByText('Choose a model to generate summaries')).toBeVisible();
    await wizard.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Setup cancelled.');
    await expect(page.getByTestId('BtnGenerateSummary')).toBeEnabled();
    expect(fs.readFileSync(fileOf(launched.dataRoot, FRESH), 'utf8')).toBe(before);
  } finally {
    await launched.close();
  }
});

test('with no model the wizard downloads one and the run goes on to a summary', async () => {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1' }, seed);
  try {
    const page = await launched.app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.evaluate(async (id) => {
      await window.vozella.invoke('workspace.dispatch', {
        action: { type: 'selectMeeting', id },
      });
      await window.vozella.invoke('workspace.dispatch', {
        action: { type: 'openSession', tab: 'Summary' },
      });
    }, FRESH);
    await expect(page.getByTestId('BtnGenerateSummary')).toBeVisible();
    await page.getByTestId('BtnGenerateSummary').click();
    await page.getByTestId('BtnDownloadModel').click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Summary generated.');
    expect(fs.readFileSync(fileOf(launched.dataRoot, FRESH), 'utf8')).toContain(
      'The team went over the plan',
    );
  } finally {
    await launched.close();
  }
});

test.describe('accessibility and screenshots', () => {
  let session: Session;
  test.beforeAll(async () => {
    session = await start({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '1500' });
  });
  test.afterAll(async () => {
    await session.launched.close();
  });

  const useTheme = async (theme: 'light' | 'dark'): Promise<void> => {
    const { page } = session;
    await page.evaluate((value) => {
      window.localStorage.setItem('vozella.theme', value);
    }, theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.evaluate(() => document.fonts.ready);
  };

  const serious = async (): Promise<unknown[]> => {
    const { page } = session;
    // Let a dialog or menu finish its fade, so the colors are the settled ones.
    await page.waitForTimeout(300);
    await page.evaluate(axe.source);
    const results = await page.evaluate(() =>
      (window as unknown as { axe: typeof axe }).axe.run(document),
    );
    return results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
      }));
  };

  const outDir = path.resolve(__dirname, '../../../docs/port/screens/summaries');
  const shoot = async (name: string): Promise<void> => {
    if (process.env.VOZELLA_SCREENSHOTS !== '1') return;
    await session.page.waitForTimeout(350);
    fs.mkdirSync(outDir, { recursive: true });
    await session.page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };

  for (const theme of ['light', 'dark'] as const) {
    test(`the action bar in every state in ${theme}`, async () => {
      const { page, open } = session;
      await useTheme(theme);

      await open(NO_ITEMS);
      await expect(page.getByTestId('BtnRegenerateSummary')).toBeVisible();
      expect(await serious()).toEqual([]);
      await shoot(`generate-regenerate-${theme}`);

      await page.getByRole('combobox', { name: 'Note template' }).click();
      await expect(page.getByRole('option', { name: 'User interview' })).toBeVisible();
      expect(await serious()).toEqual([]);
      await shoot(`generate-templates-${theme}`);
      await page.keyboard.press('Escape');

      await open(DONE);
      await page.getByRole('button', { name: 'More options' }).click();
      await expect(page.getByRole('menuitem', { name: 'Copy action items' })).toBeVisible();
      expect(await serious()).toEqual([]);
      await shoot(`generate-more-${theme}`);
      await page.getByRole('menuitem', { name: 'Copy action items' }).click();
      await expect(page.getByTestId('DraftMessage')).toBeVisible();
      await shoot(`generate-copied-${theme}`);

      await page.getByTestId('BtnRegenerateSummary').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await serious()).toEqual([]);
      await shoot(`generate-confirm-${theme}`);
      await page.getByRole('dialog').getByRole('button', { name: 'Regenerate' }).click();
      await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Generating summary...');
      expect(await serious()).toEqual([]);
      await shoot(`generate-running-${theme}`);
      await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Summary generated.');
      await shoot(`generate-done-${theme}`);
    });
  }

  test('the bar in Spanish', async () => {
    const { page, open } = session;
    await useTheme('light');
    await open(DONE);
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'es' }));
    await expect(page.getByTestId('BtnRegenerateSummary')).toHaveText('Regenerar');
    await expect(page.getByRole('combobox', { name: 'Plantilla de notas' })).toBeVisible();
    await page.getByTestId('BtnRegenerateSummary').click();
    await expect(page.getByRole('dialog', { name: '¿Reemplazar este resumen?' })).toBeVisible();
    expect(await serious()).toEqual([]);
    await shoot('generate-confirm-es');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.vozella.invoke('settings.setUiLanguage', { tag: 'en-US' }));
  });
});
