import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';
import { writeMeeting } from './library-data';

// Layout proofs for the chat that jsdom cannot give: composer sizes, bubble alignment and cap,
// the transcript filling the panel with its own scroll, auto-scroll to the end, and New chat clearing state.
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

/** Opens the AI panel from the launcher; it may already be open, since the panel remembers. */
const openPanel = async (page: Page): Promise<void> => {
  const launcher = page.getByTestId('BtnAiPanelOpen');
  const composer = page.getByTestId('TxtMeetingChat');
  // The closed panel keeps its composer in the DOM, so only the visible one counts.
  await expect(launcher.or(composer).filter({ visible: true })).toBeVisible();
  if (await launcher.isVisible()) await launcher.click();
  await expect(composer).toBeVisible();
};

async function open(env: Record<string, string>): Promise<{ launched: LaunchedApp; page: Page }> {
  const launched = await launchApp({ VOZELLA_E2E_SHOW: '1', ...env }, seed);
  const page = await launched.app.firstWindow();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.evaluate(() => window.vozella.invoke('summaries.chooseCli', { kind: 'ClaudeCode' }));
  await page.getByRole('navigation').getByRole('link', { name: 'Record' }).click();
  await openPanel(page);
  return { launched, page };
}

test('composer grows from 32 to 96, scrolls past that and keeps a 180 wide field', async () => {
  const { launched, page } = await open({});
  try {
    const box = page.getByTestId('TxtMeetingChat');
    const size = () => box.evaluate((el) => ({ h: el.getBoundingClientRect().height }));
    expect((await size()).h).toBeCloseTo(32, 0);
    await box.fill('line\n'.repeat(12));
    expect((await size()).h).toBeCloseTo(96, 0);
    expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const minWidth = await box.evaluate((el) =>
      parseFloat(getComputedStyle(el.parentElement!).minWidth),
    );
    expect(minWidth).toBe(180);
    await box.fill('word '.repeat(80));
    const wrapped = await size();
    expect(wrapped.h).toBeGreaterThan(32);
    expect(wrapped.h).toBeLessThanOrEqual(96.5);
  } finally {
    await launched.close();
  }
});

test('the transcript right-aligns bubbles at 75 percent, fills the panel and follows new rows', async () => {
  const { launched, page } = await open({});
  try {
    const box = page.getByTestId('TxtMeetingChat');
    const items = page.getByTestId('ListMeetingChat').getByRole('listitem', { name: /^You: / });
    for (let i = 0; i < 4; i += 1) {
      await box.fill(`Question ${String(i)} ${'wide '.repeat(120)}`);
      await box.press('Enter');
      await expect(items).toHaveCount(i + 1);
      await expect(page.getByTestId('BtnMeetingChatStop')).toHaveCount(0);
      await expect(page.getByTestId('BtnMeetingChatCopy')).toHaveCount(i + 1);
    }
    const list = page.getByTestId('ListMeetingChat');
    const geometry = await list.evaluate((ul) => {
      const scroller = ul.parentElement!;
      const bubble = ul.querySelector('li p')!;
      const s = scroller.getBoundingClientRect();
      const b = bubble.getBoundingClientRect();
      return {
        scrollerHeight: s.height,
        scrollerBottom: s.bottom,
        composerTop: document
          .getElementById('TxtMeetingChat')!
          .parentElement!.getBoundingClientRect().top,
        scrollable: scroller.scrollHeight > scroller.clientHeight,
        atEnd: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2,
        rightGap: s.right - b.right,
        widthRatio: b.width / s.width,
        userSelect: getComputedStyle(bubble).userSelect,
      };
    });
    // The transcript takes the panel's free height above the composer, inside the window.
    expect(geometry.scrollerHeight).toBeGreaterThan(200);
    expect(geometry.scrollerBottom).toBeLessThanOrEqual(geometry.composerTop);
    expect(geometry.scrollable).toBe(true);
    expect(geometry.atEnd).toBe(true);
    expect(geometry.rightGap).toBeLessThan(24);
    expect(geometry.widthRatio).toBeLessThanOrEqual(0.76);
    expect(geometry.userSelect).toBe('text');
  } finally {
    await launched.close();
  }
});

test('New chat clears the error and the restored draft', async () => {
  const { launched, page } = await open({ VOZELLA_FAKE_SUMMARY_FAIL: 'NotSignedIn' });
  try {
    await page.getByTestId('TxtMeetingChat').fill('Will this fail?');
    await page.getByTestId('BtnMeetingChatSend').click();
    await expect(page.getByTestId('InfoMeetingChatError')).toBeVisible();
    await expect(page.getByTestId('TxtMeetingChat')).toHaveValue('Will this fail?');
    await page.getByTestId('BtnMeetingChatNew').click();
    await expect(page.getByTestId('InfoMeetingChatError')).toHaveCount(0);
    await expect(page.getByTestId('TxtMeetingChat')).toHaveValue('');
  } finally {
    await launched.close();
  }
});
