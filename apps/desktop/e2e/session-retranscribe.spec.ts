import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// Re-transcribe from the session header, in the real app on the fake native build: the fake speech
// engine "hears" a fixed script, the fake summary provider answers after a delay the environment
// sets, and the library is a throwaway folder. No model, no CLI, no account.
// Screenshots (docs/port/screens/session-views) are rewritten only with VOZELLA_SCREENSHOTS=1.

test.describe.configure({ timeout: 150_000, mode: 'serial' });

const WITH_AUDIO = '8d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c21';
const NO_AUDIO = '9e2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c22';
const OLD_LINE = '[00:00.00-00:05.00] texto viejo';

/** A 16 kHz mono PCM16 WAV of silence; the fake engine answers by duration, not by sound. */
function silentWav(seconds: number): Buffer {
  const data = Buffer.alloc(16_000 * 2 * seconds);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function seed(dataRoot: string): void {
  const inbox = path.join(dataRoot, 'meetings', 'Inbox');
  fs.mkdirSync(inbox, { recursive: true });
  const wav = path.join(inbox, 'Weekly sync.wav');
  fs.writeFileSync(wav, silentWav(7));
  const write = (name: string, lines: string[]): void => {
    fs.writeFileSync(path.join(inbox, name), lines.join('\n'), 'utf8');
  };
  write('2026-11-02 Weekly sync.md', [
    '---',
    `id: ${WITH_AUDIO}`,
    'title: Weekly sync',
    'recordedAt: 2026-11-02T14:05:00.0000000+00:00',
    `audioFilePath: ${wav}`,
    '---',
    '',
    '## Transcript',
    '',
    OLD_LINE,
    '',
    '## Summary',
    '',
    'The old summary of the weekly sync.',
    '',
  ]);
  write('2026-11-03 Imported call.md', [
    '---',
    `id: ${NO_AUDIO}`,
    'title: Imported call',
    'recordedAt: 2026-11-03T10:00:00.0000000+00:00',
    'audioFilePath: ',
    '---',
    '',
    '## Transcript',
    '',
    '[00:00.00-00:02.00] sin audio',
    '',
  ]);
}

const fileOf = (dataRoot: string): string =>
  path.join(dataRoot, 'meetings', 'Inbox', '2026-11-02 Weekly sync.md');

interface Run {
  readonly launched: LaunchedApp;
  readonly page: Page;
}

async function start(env: Record<string, string>): Promise<Run> {
  const launched = await launchApp(
    { VOZELLA_E2E_SHOW: '1', VOZELLA_FAKE_ENGINE_INSTALLED: '1', ...env },
    seed,
  );
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1120, 780);
  });
  // A summary engine is chosen, so a finished run also writes a summary.
  await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
  return { launched, page };
}

async function open(page: Page, id: string, tab: 'Transcript' | 'Summary'): Promise<void> {
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
}

const confirm = async (page: Page): Promise<void> => {
  await page.getByTestId('BtnSessionRetranscribe').click();
  await page
    .getByRole('dialog', { name: 'Re-transcribe this meeting?' })
    .getByRole('button', { name: 'Re-transcribe', exact: true })
    .click();
};

test.describe('a run that is cancelled', () => {
  let run: Run;
  test.beforeAll(async () => {
    run = await start({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '20000' });
  });
  test.afterAll(async () => {
    await run.launched.close();
  });

  test('asks first, shows progress with Cancel, and says it was cancelled', async () => {
    const { page, launched } = run;
    await open(page, WITH_AUDIO, 'Transcript');
    const button = page.getByTestId('BtnSessionRetranscribe');
    await expect(button).toBeEnabled();

    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Re-transcribe this meeting?' });
    await expect(dialog).toContainText('Re-transcribing "Weekly sync" replaces its transcript');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(fs.readFileSync(fileOf(launched.dataRoot), 'utf8')).toContain('texto viejo');

    await confirm(page);
    const status = page.getByTestId('TextSessionRetranscribeStatus');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('ProgressSessionRetranscribe')).toHaveAccessibleName(
      'Re-transcription progress',
    );
    await expect(button).toBeDisabled();
    // The title cannot change while this meeting is being processed.
    await expect(page.getByTestId('BtnSessionRename')).toBeDisabled();
    // The transcript tab already shows the new text while the summary is still being made.
    await expect(page.getByTestId('SelectorSessionTranscript')).toBeVisible();

    await page.getByTestId('BtnSessionRetranscribeCancel').click();
    const notice = page.getByTestId('InfoSessionRetranscribeNotice');
    await expect(notice).toContainText('Re-transcription cancelled.', { timeout: 30_000 });
    await expect(status).toBeHidden();
    await expect(button).toBeEnabled();
    await expect(page.getByTestId('BtnSessionRename')).toBeEnabled();

    // The bar stays until the reader closes it.
    await page.getByTestId('BtnSessionOpenLocation').focus();
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Close' }).click();
    await expect(notice).toBeHidden();
  });
});

test.describe('a run that finishes', () => {
  let run: Run;
  test.beforeAll(async () => {
    run = await start({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '1500' });
  });
  test.afterAll(async () => {
    await run.launched.close();
  });

  test('replaces the transcript and summary, tells so, and reloads the tabs', async () => {
    const { page, launched } = run;
    await open(page, WITH_AUDIO, 'Transcript');
    await expect(page.getByText('texto viejo')).toBeVisible();

    await confirm(page);
    await expect(page.getByTestId('TextSessionRetranscribeStatus')).toBeVisible();
    const notice = page.getByTestId('InfoSessionRetranscribeNotice');
    await expect(notice).toContainText('Re-transcribed. The transcript and summary were updated.', {
      timeout: 60_000,
    });
    await expect(page.getByText('Buenos días a todos')).toBeVisible();
    await expect(page.getByText('texto viejo')).toHaveCount(0);

    const text = fs.readFileSync(fileOf(launched.dataRoot), 'utf8');
    expect(text).toContain('Buenos días a todos');
    expect(text).not.toContain('The old summary');
    await page.getByTestId('SelectorSessionSummary').click();
    await expect(page.getByText('The team went over the plan')).toBeVisible();
  });
});

test.describe('a failed run', () => {
  let run: Run;
  test.beforeAll(async () => {
    run = await start({ VOZELLA_FAKE_SUMMARY_FAIL: 'Unknown' });
  });
  test.afterAll(async () => {
    await run.launched.close();
  });

  test('saves the transcript and shows the error bar with its title', async () => {
    const { page, launched } = run;
    await open(page, WITH_AUDIO, 'Transcript');
    await confirm(page);
    const bar = page.getByTestId('InfoSessionRetranscribeError');
    await expect(bar).toContainText('Re-transcription failed', { timeout: 60_000 });
    await expect(bar).toContainText('Transcript saved. Summary failed');
    await expect.poll(() => fs.readFileSync(fileOf(launched.dataRoot), 'utf8')).toContain('Buenos');
  });
});

test.describe('a meeting without audio', () => {
  let run: Run;
  test.beforeAll(async () => {
    run = await start({});
  });
  test.afterAll(async () => {
    await run.launched.close();
  });

  test('has no Re-transcribe button', async () => {
    const { page } = run;
    await open(page, NO_AUDIO, 'Transcript');
    await expect(page.getByRole('heading', { level: 1, name: 'Imported call' })).toBeVisible();
    await expect(page.getByTestId('BtnSessionCopy')).toBeVisible();
    await expect(page.getByTestId('BtnSessionRetranscribe')).toHaveCount(0);
  });
});

test.describe('screenshots', () => {
  test.skip(process.env.VOZELLA_SCREENSHOTS !== '1', 'set VOZELLA_SCREENSHOTS=1 to capture');
  const outDir = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'docs',
    'port',
    'screens',
    'session-views',
  );

  for (const theme of ['light', 'dark'] as const) {
    test(`header, progress and outcome in ${theme}`, async () => {
      const run = await start({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '20000' });
      try {
        const { page } = run;
        fs.mkdirSync(outDir, { recursive: true });
        await page.evaluate((value) => {
          window.localStorage.setItem('vozella.theme', value);
        }, theme);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await open(page, WITH_AUDIO, 'Transcript');
        await expect(page.getByTestId('BtnSessionRetranscribe')).toBeEnabled();
        await page.screenshot({ path: path.join(outDir, `retranscribe-idle-${theme}.png`) });

        await confirm(page);
        await expect(page.getByTestId('TextSessionRetranscribeStatus')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.screenshot({ path: path.join(outDir, `retranscribe-progress-${theme}.png`) });

        await page.getByTestId('BtnSessionRetranscribeCancel').click();
        await expect(page.getByTestId('InfoSessionRetranscribeNotice')).toBeVisible({
          timeout: 30_000,
        });
        await page.screenshot({ path: path.join(outDir, `retranscribe-outcome-${theme}.png`) });
      } finally {
        await run.launched.close();
      }
    });
  }
});
