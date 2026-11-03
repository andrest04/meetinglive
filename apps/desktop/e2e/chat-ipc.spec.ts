import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// The chat channels over the real contract, in the fake native build: the FakeSummaryProvider
// answers every engine, so nothing touches a model, a CLI or the network.

const ID = '3f2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c0d';
const SCOPE = { isVisible: true, kind: 'AllMeetings', folderId: null, meetingId: null } as const;

async function open(
  extraEnv: Record<string, string> = {},
): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp(extraEnv, (dataRoot) => {
    writeMeeting(path.join(dataRoot, 'meetings'), {
      id: ID,
      title: 'Weekly sync',
      recordedAt: '2026-09-01T09:00:00.0000000+00:00',
      transcript: '[00:00.00-00:05.00] Ana: we ship on Friday',
    });
  });
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  // Collect every chunk the page receives, in arrival order.
  await page.evaluate(() => {
    const w = window as unknown as { chunks: { requestId: string; text: string }[] };
    w.chunks = [];
    window.vozella.on('chat.chunk', (payload) => {
      w.chunks.push(payload);
    });
  });
  return { launched, page };
}

const send = (page: Page, requestId: string, draft: string, scope: typeof SCOPE = SCOPE) =>
  page.evaluate((input) => window.vozella.invoke('chat.send', input), {
    requestId,
    draft,
    scope,
    liveTranscript: null,
  });

test('with no engine ready a send asks for setup and keeps the draft', async () => {
  const { launched, page } = await open();
  try {
    expect(await send(page, 'r0', 'What did we decide?')).toEqual({
      status: 'setup-required',
      kind: 'Local',
      originalDraft: 'What did we decide?',
    });
    expect(await page.evaluate(() => window.vozella.invoke('chat.state', {}))).toMatchObject({
      hasMessages: false,
      isSending: false,
    });
  } finally {
    await launched.close();
  }
});

test('a send against the fake provider streams chunks, answers, and starts a new chat', async () => {
  const { launched, page } = await open();
  try {
    await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
    const outcome = await send(page, 'r1', 'What did we decide?');
    expect(outcome).toMatchObject({
      status: 'answered',
      user: { role: 'user', text: 'What did we decide?' },
      assistant: { role: 'assistant' },
    });
    if (outcome.status !== 'answered') throw new Error('not answered');

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { chunks: unknown[] }).chunks.length))
      .toBeGreaterThan(0);
    const chunks = await page.evaluate(
      () => (window as unknown as { chunks: { requestId: string; text: string }[] }).chunks,
    );
    expect(chunks.every((chunk) => chunk.requestId === 'r1')).toBe(true);
    // Each chunk is the text so far, so each one extends the one before it.
    chunks.forEach((chunk, index) => {
      const before = chunks[index - 1]?.text ?? '';
      expect(chunk.text.startsWith(before)).toBe(true);
    });
    expect(outcome.assistant.text).toBe(chunks.at(-1)?.text.trim());

    expect(await page.evaluate(() => window.vozella.invoke('chat.state', {}))).toMatchObject({
      hasMessages: true,
      isSending: false,
      messages: [{ role: 'user' }, { role: 'assistant' }],
    });
    expect(await page.evaluate(() => window.vozella.invoke('chat.newChat', {}))).toEqual({
      started: true,
    });
    expect(await page.evaluate(() => window.vozella.invoke('chat.state', {}))).toMatchObject({
      hasMessages: false,
    });
  } finally {
    await launched.close();
  }
});

test('cancel stops a slow answer and the send ends silently with the draft back', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_DELAY_MS: '8000' });
  try {
    await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
    const running = send(page, 'r2', 'Slow question');
    await expect
      .poll(
        async () => (await page.evaluate(() => window.vozella.invoke('chat.state', {}))).isSending,
      )
      .toBe(true);
    expect(await page.evaluate(() => window.vozella.invoke('chat.newChat', {}))).toEqual({
      started: false,
    });
    expect(await page.evaluate(() => window.vozella.invoke('chat.cancel', {}))).toEqual({
      cancelled: true,
    });
    expect(await running).toEqual({ status: 'cancelled', originalDraft: 'Slow question' });
    expect(await page.evaluate(() => window.vozella.invoke('chat.cancel', {}))).toEqual({
      cancelled: false,
    });
  } finally {
    await launched.close();
  }
});

test('a failing engine is a failed value with a sentence, not a thrown error', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' });
  try {
    await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
    const outcome = await send(page, 'r3', 'Anything');
    expect(outcome).toMatchObject({
      status: 'failed',
      kind: 'send-failed',
      originalDraft: 'Anything',
    });
    expect((outcome as { message: string }).message.length).toBeGreaterThan(10);
  } finally {
    await launched.close();
  }
});

test('citation checks and links: the hex id resolves, other schemes are refused', async () => {
  const { launched, page } = await open();
  try {
    expect(
      await page.evaluate(
        (meetingId) => window.vozella.invoke('chat.meetingExists', { meetingId }),
        ID.replace(/-/g, ''),
      ),
    ).toEqual({ exists: true, meetingId: ID });
    expect(
      await page.evaluate(() =>
        window.vozella.invoke('chat.meetingExists', { meetingId: '0'.repeat(32) }),
      ),
    ).toEqual({ exists: false, meetingId: null });

    expect(
      await page.evaluate(() =>
        window.vozella.invoke('chat.openExternal', { url: 'https://example.com/' }),
      ),
    ).toEqual({ status: 'opened' });
    for (const url of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', 'ms-settings:']) {
      expect(
        await page.evaluate((u) => window.vozella.invoke('chat.openExternal', { url: u }), url),
      ).toEqual({ status: 'rejected' });
    }
  } finally {
    await launched.close();
  }
});
