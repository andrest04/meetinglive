import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp, NO_GALLERY, packaged } from './launch';
import { writeMeeting } from './library-data';

// The CLI setup dialog, the wizard CLI check and the generation gate in the real app with the
// fake native build. VOZELLA_FAKE_CLI_FILES=1 makes the CLI probe read <app data>/fake-cli: a file
// named claude or codex there means that program is installed, so a test flips the answer while
// the app runs. The FakeSummaryProvider answers once the gate lets a run through.
// Screenshots (docs/port/screens/summaries) are rewritten only with VOZELLA_SCREENSHOTS=1.

test.describe.configure({ timeout: 150_000 });

const FRESH = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const TRANSCRIPT = '[00:00.00-00:05.00] Ana: we ship on Friday\n[00:05.00-00:09.00] Leo: agreed';

const seed = (dataRoot: string): void => {
  writeMeeting(path.join(dataRoot, 'meetings'), {
    id: FRESH,
    title: 'Planning call',
    recordedAt: '2026-09-08T09:00:00.0000000+00:00',
    transcript: TRANSCRIPT,
  });
};

interface Session {
  readonly launched: LaunchedApp;
  readonly page: Page;
  /** Installs or removes a fake program on the fake PATH. */
  readonly install: (exe: 'claude' | 'codex', present: boolean) => void;
  readonly settings: () => Record<string, unknown>;
  readonly open: () => Promise<void>;
}

async function start(
  options: { settingsFile?: object; installed?: ('claude' | 'codex')[]; locale?: 'es' } = {},
): Promise<Session> {
  const launched = await launchApp(
    { VOZELLA_E2E_SHOW: '1', VOZELLA_FAKE_CLI_FILES: '1' },
    (root) => {
      seed(root);
      fs.mkdirSync(path.join(root, 'app', 'fake-cli'), { recursive: true });
      for (const exe of options.installed ?? []) {
        fs.writeFileSync(path.join(root, 'app', 'fake-cli', exe), '');
      }
      if (options.settingsFile) {
        fs.writeFileSync(
          path.join(root, 'app', 'settings.json'),
          JSON.stringify(options.settingsFile),
        );
      }
    },
  );
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 780);
  });
  if (options.locale) {
    await page.evaluate(
      (tag) => window.vozella.invoke('settings.setUiLanguage', { tag }),
      options.locale,
    );
  }
  const dir = path.join(launched.dataRoot, 'app', 'fake-cli');
  return {
    launched,
    page,
    install: (exe, present) => {
      const file = path.join(dir, exe);
      if (present) fs.writeFileSync(file, '');
      else fs.rmSync(file, { force: true });
    },
    settings: () => {
      const file = path.join(launched.dataRoot, 'app', 'settings.json');
      return fs.existsSync(file)
        ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)
        : {};
    },
    open: async () => {
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
    },
  };
}

const serious = async (page: Page) => {
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
const shoot = async (page: Page, name: string): Promise<void> => {
  if (process.env.VOZELLA_SCREENSHOTS !== '1') return;
  await page.waitForTimeout(350);
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
};

const fileText = (dataRoot: string): string => {
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
    fs.readFileSync(file, 'utf8').includes(`id: ${FRESH}`),
  );
  if (!found) throw new Error('meeting file not found');
  return fs.readFileSync(found, 'utf8');
};

test('a missing CLI opens the dialog; Retry after the install closes it and the run goes on', async () => {
  const session = await start({ installed: ['claude'] });
  try {
    const { page, install, launched, open } = session;
    await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
    install('claude', false);
    await open();
    await page.getByTestId('BtnGenerateSummary').click();

    const dialog = page.getByRole('dialog', { name: 'Set up the Claude Code CLI' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Not found on PATH')).toBeVisible();
    await expect(dialog.getByTestId('TxtCliMessage')).toContainText('find "claude" on your PATH');
    await expect(
      dialog.getByRole('link', { name: 'https://claude.com/claude-code' }),
    ).toBeVisible();
    expect(await serious(page)).toEqual([]);

    // Not installed yet: the dialog stays and says so.
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(dialog.getByTestId('TxtCliMessage')).toContainText(
      'Still not found on PATH as "claude".',
    );
    await expect(dialog).toBeVisible();
    expect(fileText(launched.dataRoot)).not.toContain('The team went over the plan');

    install('claude', true);
    await dialog.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Summary generated.');
    expect(fileText(launched.dataRoot)).toContain('The team went over the plan');
  } finally {
    await session.launched.close();
  }
});

test('cancelling the CLI dialog ends the run as setup cancelled and leaves the file alone', async () => {
  const session = await start({ settingsFile: { selectedSummaryProvider: 'Codex' } });
  try {
    const { page, launched, open } = session;
    await open();
    const before = fileText(launched.dataRoot);
    await page.getByTestId('BtnGenerateSummary').click();
    const dialog = page.getByRole('dialog', { name: 'Set up the Codex CLI' });
    await expect(dialog.getByTestId('TxtCliMessage')).toContainText('npm install -g @openai/codex');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('TxtSummaryStatus')).toContainText('Setup cancelled.');
    expect(fileText(launched.dataRoot)).toBe(before);
  } finally {
    await session.launched.close();
  }
});

test('a settings file that selects Grok gets a notice with a link to Settings', async () => {
  const session = await start({ settingsFile: { selectedSummaryProvider: 'Xai' } });
  try {
    const { page, open } = session;
    await open();
    await page.getByTestId('BtnGenerateSummary').click();
    const notice = page.getByTestId('TxtProviderUnavailable');
    await expect(notice).toContainText('Grok (xAI) is no longer available');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await serious(page)).toEqual([]);
    await page.getByTestId('BtnOpenSettings').click();
    await expect(page).toHaveURL(/#\/settings$/);
  } finally {
    await session.launched.close();
  }
});

test.describe('the wizard CLI path', () => {
  test.skip(packaged, NO_GALLERY);
  const openChooser = async (page: Page): Promise<void> => {
    await page.evaluate(() => {
      window.location.hash = '#/gallery';
    });
    await expect(page.getByTestId('gallery')).toBeVisible();
    await page.getByRole('button', { name: 'Open the wizard' }).click();
    await expect(page.getByRole('dialog', { name: 'Set up summary generation' })).toBeVisible();
  };

  test('a missing CLI: check again misses, then finds it, saves it and closes', async () => {
    const session = await start();
    try {
      const { page, install, settings } = session;
      await openChooser(page);
      await page.getByTestId('BtnEngineCodex').click();
      const message = page.getByTestId('TxtCliMessage');
      await expect(message).toContainText('Once it\'s installed, select "Check again".');
      expect(await serious(page)).toEqual([]);

      await page.getByTestId('BtnRecheckCli').click();
      await expect(message).toContainText('Still not found on PATH as "codex".');
      expect(settings().selectedSummaryProvider ?? null).toBeNull();

      // Back goes to the chooser; the engine can be picked again.
      await page.getByTestId('BtnBackToEngineChoice').click();
      await expect(page.getByTestId('BtnEngineLocal')).toBeVisible();
      await page.getByTestId('BtnEngineCodex').click();
      await expect(message).toBeVisible();

      install('codex', true);
      await page.getByTestId('BtnRecheckCli').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(settings()).toMatchObject({ selectedSummaryProvider: 'Codex' });
    } finally {
      await session.launched.close();
    }
  });

  test('a CLI that is already there is saved on picking it and the wizard closes', async () => {
    const session = await start({ installed: ['claude'] });
    try {
      const { page, settings } = session;
      await openChooser(page);
      await page.getByTestId('BtnEngineClaudeCode').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(settings()).toMatchObject({ selectedSummaryProvider: 'ClaudeCode' });
    } finally {
      await session.launched.close();
    }
  });
});

test('the dialog and the panel speak Spanish', async () => {
  const session = await start({
    settingsFile: { selectedSummaryProvider: 'ClaudeCode' },
    locale: 'es',
  });
  try {
    const { page, open } = session;
    await open();
    await page.getByTestId('BtnGenerateSummary').click();
    const dialog = page.getByRole('dialog', { name: 'Configurar la CLI de Claude Code' });
    await expect(dialog.getByText('No se encontró en el PATH')).toBeVisible();
    await dialog.getByRole('button', { name: 'Reintentar' }).click();
    await expect(dialog.getByTestId('TxtCliMessage')).toContainText('Sigue sin encontrarse');
    expect(await serious(page)).toEqual([]);
    await shoot(page, 'cli-setup-es');
  } finally {
    await session.launched.close();
  }
});

test.describe('screenshots', () => {
  test.skip(packaged, NO_GALLERY);
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');

  for (const theme of ['light', 'dark'] as const) {
    test(`dialog, panel and notice in ${theme}`, async () => {
      const session = await start({ settingsFile: { selectedSummaryProvider: 'ClaudeCode' } });
      try {
        const { page, open } = session;
        await page.evaluate((value) => {
          window.localStorage.setItem('vozella.theme', value);
        }, theme);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await page.evaluate(() => document.fonts.ready);
        await open();
        await page.getByTestId('BtnGenerateSummary').click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await shoot(page, `cli-setup-${theme}`);
        await dialog.getByRole('button', { name: 'Retry' }).click();
        await expect(dialog.getByTestId('TxtCliMessage')).toContainText('Still not found');
        await shoot(page, `cli-setup-missing-${theme}`);
        await dialog.getByRole('button', { name: 'Cancel' }).click();

        await page.evaluate(() => {
          window.location.hash = '#/gallery';
        });
        await page.getByRole('button', { name: 'Open the wizard' }).click();
        await page.getByTestId('BtnEngineCodex').click();
        await expect(page.getByTestId('PanelCliCheck')).toBeVisible();
        await shoot(page, `wizard-cli-${theme}`);
      } finally {
        await session.launched.close();
      }
    });

    test(`the Grok notice in ${theme}`, async () => {
      const session = await start({ settingsFile: { selectedSummaryProvider: 'Xai' } });
      try {
        const { page, open } = session;
        await page.evaluate((value) => {
          window.localStorage.setItem('vozella.theme', value);
        }, theme);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await open();
        await page.getByTestId('BtnGenerateSummary').click();
        await expect(page.getByTestId('TxtProviderUnavailable')).toBeVisible();
        await shoot(page, `provider-unavailable-${theme}`);
      } finally {
        await session.launched.close();
      }
    });
  }
});
