import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The summary channels over the real contract, in the fake native build: a fake model store, a
// fake CLI probe and the FakeSummaryProvider, so nothing touches the network or a real CLI.

const ID = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

async function open(
  extraEnv: Record<string, string> = {},
  seed?: (dataRoot: string) => void,
): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp(extraEnv, (dataRoot) => {
    writeMeeting(path.join(dataRoot, 'meetings'), {
      id: ID,
      title: 'Weekly sync',
      recordedAt: '2026-09-01T09:00:00.0000000+00:00',
      transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
    });
    seed?.(dataRoot);
  });
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  return { launched, page };
}

test.describe('local engine and the full tab round trip', () => {
  let launched: LaunchedApp;
  let page: Page;

  test.beforeAll(async () => {
    ({ launched, page } = await open());
  });
  test.afterAll(async () => {
    await launched.close();
  });

  test('the gate asks for a model, the wizard options pick a default, choosing downloads it', async () => {
    const status = await page.evaluate(() => window.vozella.invoke('summaries.providerStatus', {}));
    expect(status).toEqual({ status: 'needs-setup', kind: 'Local', reason: 'model-missing' });

    const options = await page.evaluate(() => window.vozella.invoke('summaries.hardware', {}));
    expect(options.rows.length).toBeGreaterThan(1);
    expect(options.rows.some((row) => row.downloaded)).toBe(false);
    expect(options.defaultFileName).toBe(
      options.rows.find((row) => row.fit === 'Recommended')?.fileName ?? options.rows[0]?.fileName,
    );

    const chosen = await page.evaluate(
      (fileName) => window.vozella.invoke('summaries.chooseLocalModel', { fileName }),
      MODEL,
    );
    expect(chosen.status).toBe('saved');
    expect(
      await page.evaluate(() => window.vozella.invoke('summaries.providerStatus', {})),
    ).toEqual({ status: 'ready', kind: 'Local' });
    const again = await page.evaluate(() => window.vozella.invoke('summaries.hardware', {}));
    expect(again.defaultFileName).toBe(MODEL);
  });

  test('generate saves the summary, the tab shows it, actions toggle and copy', async () => {
    const outcome = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.generate', { meetingId, regenerate: false }),
      ID,
    );
    expect(outcome).toMatchObject({
      status: 'generated',
      title: 'Weekly sync',
      titleChanged: false,
      providerId: 'local',
    });

    const loaded = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.loadTab', { meetingId }),
      ID,
    );
    if (loaded.status !== 'loaded') throw new Error('tab did not load');
    expect(loaded.generating).toBe(false);
    expect(loaded.state.title).toBe('Weekly sync');
    expect(loaded.state.summary).toContain('Overview');
    expect(loaded.state.actionItems.map((item) => item.text)).toEqual([
      'Send the notes to the team',
      'Book the follow-up call',
    ]);

    const toggled = await page.evaluate(
      (meetingId) =>
        window.vozella.invoke('summaries.toggleAction', { meetingId, index: 1, done: true }),
      ID,
    );
    expect(toggled.status).toBe('saved');
    const copied = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.copyActions', { meetingId }),
      ID,
    );
    expect(copied).toEqual({
      status: 'copied',
      text: '- [ ] Send the notes to the team\n- [x] Book the follow-up call',
    });

    const notes = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.saveNotes', { meetingId, text: 'n1' }),
      ID,
    );
    expect(notes).toEqual({ status: 'saved' });
    const template = await page.evaluate(
      (meetingId) =>
        window.vozella.invoke('summaries.setTemplate', { meetingId, templateId: 'standup' }),
      ID,
    );
    expect(template).toEqual({ status: 'saved' });
  });
});

test('a CLI engine: choosing it checks PATH, a failed run is a value with the sentence', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' });
  try {
    expect(
      await page.evaluate(() => window.vozella.invoke('summaries.checkCli', { kind: 'Codex' })),
    ).toMatchObject({ found: false, executable: 'codex', hintKey: 'Cli_CodexHint' });
    expect(
      await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'Codex' })),
    ).toMatchObject({ status: 'not-found' });
    expect(
      await page.evaluate(() =>
        window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }),
      ),
    ).toMatchObject({ status: 'saved' });

    const outcome = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.generate', { meetingId, regenerate: false }),
      ID,
    );
    expect(outcome).toMatchObject({ status: 'failed', code: 'CliNotSignedIn' });
    expect((outcome as { message: string }).message.length).toBeGreaterThan(10);
  } finally {
    await launched.close();
  }
});

test('a slow run can be cancelled, and a second generate is busy while it runs', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '8000' });
  try {
    await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
    const progress = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          window.vozella.on('summaries.progress', (event) => {
            resolve(event.running);
          });
          void window.vozella.invoke('summaries.generate', {
            meetingId: '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d',
            regenerate: false,
          });
        }),
    );
    expect(progress).toBe(true);

    const second = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.generate', { meetingId, regenerate: false }),
      ID,
    );
    expect(second).toEqual({ status: 'busy' });
    const tab = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.loadTab', { meetingId }),
      ID,
    );
    expect(tab).toMatchObject({ status: 'loaded', generating: true });

    expect(
      await page.evaluate(
        (meetingId) => window.vozella.invoke('summaries.cancel', { meetingId }),
        ID,
      ),
    ).toEqual({ cancelled: true });
    await expect
      .poll(
        async () => {
          const next = await page.evaluate(
            (meetingId) => window.vozella.invoke('summaries.loadTab', { meetingId }),
            ID,
          );
          return next.status === 'loaded' ? next.generating : null;
        },
        { timeout: 5_000 },
      )
      .toBe(false);
  } finally {
    await launched.close();
  }
});

test('a settings file that selects Xai gives the unavailable status, not a setup dialog', async () => {
  const { launched, page } = await open({}, (dataRoot) => {
    fs.mkdirSync(path.join(dataRoot, 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(dataRoot, 'app', 'settings.json'),
      JSON.stringify({ selectedSummaryProvider: 'Xai' }),
    );
  });
  try {
    expect(
      await page.evaluate(() => window.vozella.invoke('summaries.providerStatus', {})),
    ).toEqual({ status: 'unavailable', reason: 'xai-removed' });
    const outcome = await page.evaluate(
      (meetingId) => window.vozella.invoke('summaries.generate', { meetingId, regenerate: false }),
      ID,
    );
    expect(outcome).toEqual({ status: 'unavailable', reason: 'xai-removed' });
  } finally {
    await launched.close();
  }
});
