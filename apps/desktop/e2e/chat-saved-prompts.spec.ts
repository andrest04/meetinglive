import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Saved prompts (Phase 5) against the fake engines: create one from the `/` menu, find it first
// in the menu and the chips, run it with its own engine, edit it, delete it, and send a set
// through export and import with the system dialogs stubbed. Nothing touches a model.
test.describe.configure({ timeout: 150_000 });

const seed = (dataRoot: string): void => {
  writeMeeting(path.join(dataRoot, 'meetings'), {
    id: 'a0000000-0000-4000-8000-000000000000',
    title: 'Weekly planning',
    recordedAt: '2026-09-03T10:30:00.0000000-05:00',
    summary: 'Agreed the scope for the September release.',
    transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
  });
};

interface Rig {
  readonly launched: LaunchedApp;
  readonly page: Page;
  readonly filesDir: string;
  readonly promptLog: string;
}

/**
 * The engine in Settings stays Local, which the fake build has not set up: a normal send would
 * stop at the setup gate. A prompt that names Claude Code answers at once, which proves the
 * per-prompt engine.
 */
async function open(): Promise<Rig> {
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-e2e-prompts-'));
  const promptLog = path.join(filesDir, 'prompts.log');
  const launched = await launchApp(
    { VOZELLA_E2E_SHOW: '1', VOZELLA_FAKE_CHAT_PROMPT_LOG: promptLog },
    seed,
  );
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  return { launched, page, filesDir, promptLog };
}

async function close(rig: Rig): Promise<void> {
  await rig.launched.close();
  fs.rmSync(rig.filesDir, { recursive: true, force: true });
}

const openPanel = async (page: Page): Promise<void> => {
  const launcher = page.getByTestId('BtnAiPanelOpen');
  const composer = page.getByTestId('TxtMeetingChat');
  await expect(launcher.or(composer).filter({ visible: true })).toBeVisible();
  if (await launcher.isVisible()) await launcher.click();
  await expect(composer).toBeVisible();
};

const openMenu = async (page: Page) => {
  await page.getByTestId('BtnMeetingChatRecipes').click();
  return page.getByTestId('ListMeetingChatRecipes');
};

const promptsFile = (rig: Rig): string =>
  path.join(rig.launched.dataRoot, 'app', 'chat-prompts.json');

test('create a saved prompt, find it first, run it with its engine, edit and delete it', async () => {
  const rig = await open();
  const { page } = rig;
  try {
    await openPanel(page);

    // Create from the `/` menu.
    await page.getByTestId('TxtMeetingChat').fill('/');
    await page.getByTestId('BtnChatPromptNew').click();
    const dialog = page.getByRole('dialog', { name: 'New prompt' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('TxtChatPromptName')).toBeFocused();
    await dialog.getByTestId('TxtChatPromptName').fill('Risk review');
    await dialog.getByTestId('TxtChatPromptText').fill('List the open risks and who owns each.');
    // All meetings is the scope, so "Several meetings" is already chosen.
    await expect(dialog.getByRole('radio', { name: 'Several meetings' })).toBeChecked();
    await dialog.getByTestId('CmbChatPromptEngine').click();
    await page.getByRole('option', { name: 'Claude Code' }).click();
    await dialog.getByTestId('BtnChatPromptSave').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('TxtMeetingChat')).toBeFocused();

    const stored = JSON.parse(fs.readFileSync(promptsFile(rig), 'utf8')) as {
      version: number;
      prompts: { name: string; engine: string | null; availability: string }[];
    };
    expect(stored.version).toBe(1);
    expect(stored.prompts).toMatchObject([
      { name: 'Risk review', engine: 'claude-code', availability: 'multiple' },
    ]);

    // First in the chips and first in the `/` filter.
    const chips = page.getByTestId('ListMeetingChatStarters').getByRole('button');
    await expect(chips).toHaveCount(4);
    await expect(chips.first()).toHaveText('Risk review');
    await page.getByTestId('TxtMeetingChat').fill('/risk');
    const list = page.getByTestId('ListMeetingChatRecipes');
    await expect(list.getByRole('group', { name: 'Your prompts' })).toBeVisible();
    await expect(list.getByRole('option').first()).toContainText('Risk review');
    await page.getByTestId('TxtMeetingChat').fill('');

    // Run it from the chip: Claude Code answers although Settings say Local.
    await chips.first().click();
    const transcript = page.getByTestId('ListMeetingChat');
    // Rows only: the fake answer has list items of its own.
    const rows = transcript.locator(':scope > li');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('BtnMeetingChatCopy')).toBeVisible();
    const log = fs.readFileSync(rig.promptLog, 'utf8');
    expect(log).toContain('List the open risks and who owns each.');
    expect(log).toContain('<<<ENGINE claude-code>>>');

    // Save as prompt from the sent message opens the editor with its text.
    const mine = rows.first();
    await mine.hover();
    await mine.getByTestId('BtnMeetingChatSaveAsPrompt').click();
    const fromMessage = page.getByRole('dialog', { name: 'New prompt' });
    await expect(fromMessage.getByTestId('TxtChatPromptText')).toHaveValue(
      'List the open risks and who owns each.',
    );
    await fromMessage.getByTestId('BtnChatPromptCancel').click();
    await expect(fromMessage).toBeHidden();

    // Edit with the keyboard: highlight it, Tab to Edit.
    await page.getByTestId('TxtMeetingChat').focus();
    await page.keyboard.type('/risk');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('BtnChatPromptEdit')).toBeFocused();
    await page.keyboard.press('Enter');
    const edit = page.getByRole('dialog', { name: 'Edit prompt' });
    await expect(edit.getByTestId('TxtChatPromptName')).toHaveValue('Risk review');
    await edit.getByTestId('TxtChatPromptName').fill('Risk list');
    await edit.getByTestId('BtnChatPromptSave').click();
    await expect(edit).toBeHidden();
    await page.getByTestId('TxtMeetingChat').fill('');
    await expect((await openMenu(page)).getByRole('option', { name: /Risk list/ })).toBeVisible();

    // Delete from the row icon, after the question.
    const row = list.getByRole('option', { name: /Risk list/ });
    await row.hover();
    await row.getByTestId('BtnChatPromptRowDelete').click();
    const confirm = page.getByRole('dialog', { name: 'Delete this prompt?' });
    await expect(confirm).toContainText('“Risk list” will be removed from your prompts.');
    await confirm.getByTestId('BtnChatPromptDeleteConfirm').click();
    await expect(confirm).toBeHidden();
    await expect((await openMenu(page)).getByRole('group', { name: 'Your prompts' })).toHaveCount(
      0,
    );
    const after = JSON.parse(fs.readFileSync(promptsFile(rig), 'utf8')) as { prompts: unknown[] };
    expect(after.prompts).toEqual([]);
  } finally {
    await close(rig);
  }
});

test('export then import round-trips; a file that is not a prompts file is refused', async () => {
  const rig = await open();
  const { page } = rig;
  try {
    await openPanel(page);
    await page.evaluate(() =>
      window.vozella.invoke('chat.prompts.create', {
        draft: {
          name: 'Weekly status',
          prompt: 'Write the weekly status from these meetings.',
          availability: 'multiple',
          engine: 'codex',
        },
      }),
    );
    await expect(
      page.getByTestId('ListMeetingChatStarters').getByRole('button').first(),
    ).toHaveText('Weekly status');

    // Export through a stubbed save dialog.
    const exported = path.join(rig.filesDir, 'team.vozella-prompts.json');
    await rig.launched.app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file });
    }, exported);
    await openMenu(page);
    await page.getByTestId('BtnChatPromptsExport').click();
    await expect(page.getByTestId('InfoChatPromptsNotice')).toContainText('1 prompt exported.');
    expect(JSON.parse(fs.readFileSync(exported, 'utf8'))).toEqual({
      version: 1,
      prompts: [
        {
          name: 'Weekly status',
          prompt: 'Write the weekly status from these meetings.',
          availability: 'multiple',
          engine: 'codex',
        },
      ],
    });

    // Import the same file back: the taken name gets a number.
    const pickNext = (file: string) =>
      rig.launched.app.evaluate(({ dialog }, picked) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
      }, file);
    await pickNext(exported);
    await openMenu(page);
    await page.getByTestId('BtnChatPromptsImport').click();
    await expect(page.getByTestId('InfoChatPromptsNotice')).toContainText(
      '1 prompt imported. 1 got a number because the name was taken.',
    );
    const mine = (await openMenu(page)).getByRole('group', { name: 'Your prompts' });
    await expect(mine.getByRole('option')).toHaveCount(2);
    await expect(mine.getByRole('option').nth(1)).toContainText('Weekly status (2)');
    await page.keyboard.press('Escape');

    // A file that is not a prompts file adds nothing.
    const junk = path.join(rig.filesDir, 'notes.json');
    fs.writeFileSync(junk, '{"version":1,"prompts":[{"name":"","prompt":"x"}]}');
    await pickNext(junk);
    await openMenu(page);
    await page.getByTestId('BtnChatPromptsImport').click();
    await expect(page.getByTestId('InfoChatPromptsNotice')).toContainText(
      'This is not a Vozella prompts file. Nothing was added.',
    );
    const stored = JSON.parse(fs.readFileSync(promptsFile(rig), 'utf8')) as { prompts: unknown[] };
    expect(stored.prompts).toHaveLength(2);
  } finally {
    await close(rig);
  }
});
