import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Files attached to the chat (Phase 3): picked through a stubbed system dialog, read in main,
// shown as chips, and packed into the prompt the fake engine receives. Nothing touches a model.
test.describe.configure({ timeout: 120_000 });

const MEETING = 'a0000000-0000-4000-8000-000000000000';

const seed = (dataRoot: string): void => {
  writeMeeting(path.join(dataRoot, 'meetings'), {
    id: MEETING,
    title: 'Weekly planning',
    recordedAt: '2026-09-03T10:30:00.0000000-05:00',
    summary: 'Agreed the scope for the September release.',
    transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
  });
};

/** A one-page PDF with one line of text: enough for pdfjs to read a page back. */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

interface Rig {
  readonly launched: LaunchedApp;
  readonly page: Page;
  readonly filesDir: string;
  readonly promptLog: string;
}

async function open(): Promise<Rig> {
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-e2e-files-'));
  const promptLog = path.join(filesDir, 'prompts.log');
  const launched = await launchApp(
    { VOZELLA_E2E_SHOW: '1', VOZELLA_FAKE_CHAT_PROMPT_LOG: promptLog },
    seed,
  );
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
  return { launched, page, filesDir, promptLog };
}

async function close(rig: Rig): Promise<void> {
  await rig.launched.close();
  fs.rmSync(rig.filesDir, { recursive: true, force: true });
}

/** The next system file dialog answers these paths. */
const pickNext = (rig: Rig, files: readonly string[]) =>
  rig.launched.app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [...paths] });
  }, files);

const openPanel = async (page: Page): Promise<void> => {
  const launcher = page.getByTestId('BtnAiPanelOpen');
  const composer = page.getByTestId('TxtMeetingChat');
  await expect(launcher.or(composer).filter({ visible: true })).toBeVisible();
  if (await launcher.isVisible()) await launcher.click();
  await expect(composer).toBeVisible();
};

test('attach a TXT and a PDF, ask, and the prompt carries both files', async () => {
  const rig = await open();
  const { page } = rig;
  try {
    const txt = path.join(rig.filesDir, 'budget notes.txt');
    fs.writeFileSync(txt, '﻿The marketing budget is 42000 dollars.');
    const pdf = path.join(rig.filesDir, 'roadmap.pdf');
    fs.writeFileSync(pdf, tinyPdf('Launch moves to October'));

    await openPanel(page);
    await pickNext(rig, [txt, pdf]);
    await page.getByRole('button', { name: 'Attach files' }).click();

    const chips = page.getByRole('list', { name: 'Attached files' });
    await expect(chips.getByRole('listitem')).toHaveCount(2);
    await expect(chips.getByRole('listitem').nth(0)).toContainText('budget notes.txt');
    await expect(chips.getByRole('listitem').nth(1)).toContainText('roadmap.pdf');
    await expect(chips.getByRole('listitem').nth(1)).toContainText('1 page');

    await page.getByTestId('TxtMeetingChat').fill('What is the budget and when is the launch?');
    await page.getByTestId('TxtMeetingChat').press('Enter');
    await expect(
      page.getByTestId('ListMeetingChat').getByText('The team went over the plan'),
    ).toBeVisible();

    const prompt = fs.readFileSync(rig.promptLog, 'utf8');
    expect(prompt).toContain('# Attached files');
    expect(prompt).toContain('File: budget notes.txt\nThe marketing budget is 42000 dollars.');
    expect(prompt).toContain('File: roadmap.pdf (PDF, 1 page)\n[page 1]\nLaunch moves to October');
    expect(prompt).toContain('(<file name>, p. N)');
    expect(prompt).not.toContain(rig.filesDir);

    // The chips stay for the conversation; New chat clears them.
    await expect(chips.getByRole('listitem')).toHaveCount(2);
    await page.getByTestId('BtnMeetingChatNew').click();
    await expect(page.getByRole('list', { name: 'Attached files' })).toHaveCount(0);
  } finally {
    await close(rig);
  }
});

test('a refused file shows why, and remove takes a chip away', async () => {
  const rig = await open();
  const { page } = rig;
  try {
    const exe = path.join(rig.filesDir, 'setup.exe');
    fs.writeFileSync(exe, 'MZ');
    const md = path.join(rig.filesDir, 'notes.md');
    fs.writeFileSync(md, '# Notes\nShip it.');

    await openPanel(page);
    await pickNext(rig, [exe, md]);
    await page.getByRole('button', { name: 'Attach files' }).click();
    const chips = page.getByRole('list', { name: 'Attached files' });
    await expect(chips.getByRole('listitem').nth(0)).toContainText(
      'This type of file cannot be attached',
    );
    await page.getByRole('button', { name: 'Remove setup.exe' }).click();
    await expect(chips.getByRole('listitem')).toHaveCount(1);
    await expect(chips).toContainText('notes.md');
    await expect(page.getByTestId('TxtMeetingChat')).toBeFocused();
  } finally {
    await close(rig);
  }
});

test('a dropped path must be a real local file of an allowed type', async () => {
  const rig = await open();
  const { page } = rig;
  try {
    await openPanel(page);
    const missing = path.join(rig.filesDir, 'gone.pdf');
    const result = await page.evaluate(
      (paths) => window.vozella.invoke('chat.attach.drop', { paths }),
      [missing, '\\\\server\\share\\x.pdf'],
    );
    expect(result.attachments.map((a) => [a.name, a.status])).toEqual([
      ['gone.pdf', 'error'],
      ['x.pdf', 'error'],
    ]);
    await expect(page.getByRole('list', { name: 'Attached files' })).toContainText(
      'Not a file on this computer.',
    );
  } finally {
    await close(rig);
  }
});
