// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { SummaryTab } from './SummaryTab';
import { installSummariesApi, tabState, withSummary } from './summaries-test-kit';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const SUMMARY =
  '### Key points\n\nWe **agreed** to ship on Friday.\n\n- Fix the build\n- Tell support';
const ITEMS = [
  { text: 'Send the notes', isDone: false },
  { text: 'Book the room', isDone: true },
];

const loaded = (state = withSummary(SUMMARY, { actionItems: ITEMS })) => ({
  'summaries.loadTab': () => ({ status: 'loaded', state, generating: false }),
});

const mount = (locale: 'en' | 'es' = 'en', meetingId: string | null = 'm1') =>
  render(
    <Providers locale={locale}>
      <SummaryTab meetingId={meetingId} />
    </Providers>,
  );

const calls = (api: ReturnType<typeof installSummariesApi>, name: string) =>
  api.calls.filter((call) => call.name === name);

describe('SummaryTab reading view', () => {
  it('shows a skeleton of the layout while it loads, then the summary as a document', async () => {
    installSummariesApi(loaded());
    mount();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    const content = await screen.findByTestId('TxtSummaryContent');
    expect(within(content).getByRole('heading', { level: 4, name: 'Key points' })).toBeVisible();
    expect(within(content).getByText('agreed').tagName).toBe('STRONG');
    expect(within(content).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('lists the action items under their heading, one checkbox each', async () => {
    installSummariesApi(loaded());
    mount();
    const list = await screen.findByTestId('ListActionItems');
    expect(screen.getByRole('heading', { name: 'Action items' })).toBeVisible();
    const boxes = within(list).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(within(list).getByRole('checkbox', { name: 'Send the notes' })).not.toBeChecked();
    expect(within(list).getByRole('checkbox', { name: 'Book the room' })).toBeChecked();
  });

  it('never turns the reply into markup or a script link (item 85)', async () => {
    const hostile = [
      '<script>window.__pwned = 1</script>',
      '<img src=x onerror="window.__pwned = 2">',
      '[open](javascript:window.__pwned=3)',
      '[data](data:text/html,<b>x</b>)',
      '[fine](https://example.com/page)',
    ].join('\n\n');
    installSummariesApi(loaded(withSummary(hostile)));
    mount();
    const content = await screen.findByTestId('TxtSummaryContent');
    expect(content.querySelector('script, img, iframe')).toBeNull();
    expect(content).toHaveTextContent('<script>window.__pwned = 1</script>');
    const links = [...content.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/page']);
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('shows the empty state with a call to record, which asks the workspace to navigate', async () => {
    const api = installSummariesApi();
    mount();
    expect(await screen.findByText(/There's no summary yet/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Record a meeting' }));
    expect(calls(api, 'workspace.dispatch')[0]?.input).toEqual({
      action: { type: 'navigateTo', tag: 'Recording' },
    });
  });

  it('hides the mode bar when there is no meeting', async () => {
    installSummariesApi(
      loaded(tabState({ meetingId: null, hasMeeting: false, title: 'No summaries yet' })),
    );
    mount('en', null);
    expect(await screen.findByText(/There's no summary yet/)).toBeVisible();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('keeps a failed load readable', async () => {
    installSummariesApi({ 'summaries.loadTab': () => ({ status: 'failed', detail: 'disk gone' }) });
    mount();
    expect(await screen.findByText('disk gone')).toBeVisible();
  });

  it('speaks Spanish', async () => {
    installSummariesApi(loaded());
    mount('es');
    expect(await screen.findByRole('radio', { name: 'Mis notas' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Mejoradas' })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Elementos de acción' })).toBeVisible();
  });
});

describe('SummaryTab mode and notes', () => {
  it('starts on Enhanced and moves with the arrow keys', async () => {
    installSummariesApi(loaded());
    mount();
    const enhanced = await screen.findByRole('radio', { name: 'Enhanced' });
    expect(enhanced).toBeChecked();
    expect(screen.getByRole('radio', { name: 'My notes' })).not.toBeChecked();
    enhanced.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'My notes' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Your notes' })).toHaveAttribute(
      'placeholder',
      'Add your notes for this meeting',
    );
    expect(screen.queryByTestId('TxtSummaryContent')).toBeNull();
  });

  it('saves the notes on blur, once, and not again when nothing changed', async () => {
    const api = installSummariesApi(loaded(withSummary(SUMMARY, { notes: 'old' })));
    mount();
    await userEvent.click(await screen.findByRole('radio', { name: 'My notes' }));
    const box = screen.getByTestId('TxtMeetingNotes');
    expect(box).toHaveValue('old');
    await userEvent.clear(box);
    await userEvent.type(box, 'new text');
    expect(calls(api, 'summaries.saveNotes')).toHaveLength(0);
    await userEvent.tab();
    await waitFor(() => {
      expect(calls(api, 'summaries.saveNotes')).toHaveLength(1);
    });
    expect(calls(api, 'summaries.saveNotes')[0]?.input).toEqual({
      meetingId: 'm1',
      text: 'new text',
    });
    await userEvent.click(screen.getByRole('radio', { name: 'Enhanced' }));
    expect(calls(api, 'summaries.saveNotes')).toHaveLength(1);
  });

  it('saves on the switch to Enhanced even without a blur', async () => {
    const api = installSummariesApi(loaded());
    mount();
    await userEvent.click(await screen.findByRole('radio', { name: 'My notes' }));
    await userEvent.type(screen.getByTestId('TxtMeetingNotes'), 'draft');
    await userEvent.click(screen.getByRole('radio', { name: 'Enhanced' }));
    await waitFor(() => {
      expect(calls(api, 'summaries.saveNotes').some((c) => c.input.text === 'draft')).toBe(true);
    });
  });

  it('saves what was typed when the page goes away', async () => {
    const api = installSummariesApi(loaded());
    const view = mount();
    await userEvent.click(await screen.findByRole('radio', { name: 'My notes' }));
    await userEvent.type(screen.getByTestId('TxtMeetingNotes'), 'bye');
    view.unmount();
    await waitFor(() => {
      expect(calls(api, 'summaries.saveNotes').some((c) => c.input.text === 'bye')).toBe(true);
    });
  });
});

describe('SummaryTab action items', () => {
  it('ticks at once and sends the change', async () => {
    const api = installSummariesApi({
      ...loaded(),
      'summaries.toggleAction': () => ({
        status: 'saved',
        actionItems: [{ text: 'Send the notes', isDone: true }, ITEMS[1]],
      }),
    });
    mount();
    const box = await screen.findByRole('checkbox', { name: 'Send the notes' });
    await userEvent.click(box);
    expect(box).toBeChecked();
    await waitFor(() => {
      expect(calls(api, 'summaries.toggleAction')[0]?.input).toEqual({
        meetingId: 'm1',
        index: 0,
        done: true,
      });
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('puts the box back and says why when the save fails', async () => {
    installSummariesApi({
      ...loaded(),
      'summaries.toggleAction': () => ({
        status: 'failed',
        message: 'Error saving the action item: disk full',
        detail: 'disk full',
      }),
    });
    mount();
    const box = await screen.findByRole('checkbox', { name: 'Send the notes' });
    await userEvent.click(box);
    expect(await screen.findByText('Error saving the action item: disk full')).toBeVisible();
    expect(box).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/disk full/)).toBeNull();
  });

  it('also rolls back when the request itself throws', async () => {
    installSummariesApi({
      ...loaded(),
      'summaries.toggleAction': () => {
        throw new Error('bridge down');
      },
    });
    mount();
    const box = await screen.findByRole('checkbox', { name: 'Book the room' });
    await userEvent.click(box);
    expect(await screen.findByText('Error saving the action item: bridge down')).toBeVisible();
    expect(box).toBeChecked();
  });
});

describe('SummaryTab related meetings', () => {
  const related = [
    { id: 'm2', title: 'Weekly sync', recordedAt: '2026-09-01T09:00:00.0000000+00:00' },
    { id: 'm3', title: 'Weekly sync', recordedAt: '2026-09-08T09:00:00.0000000+00:00' },
  ];

  it('lists them and opens the picked one on its Summary tab', async () => {
    const api = installSummariesApi(loaded(withSummary(SUMMARY, { related })));
    mount();
    const nav = await screen.findByRole('navigation', { name: 'Related meetings' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    const second = buttons.at(1);
    if (!second) throw new Error('second related meeting missing');
    await userEvent.click(second);
    await waitFor(() => {
      expect(calls(api, 'workspace.dispatch').map((c) => c.input.action)).toEqual([
        { type: 'selectMeeting', id: 'm3' },
        { type: 'openSession', tab: 'Summary' },
      ]);
    });
  });

  it('shows nothing when there are none', async () => {
    installSummariesApi(loaded());
    mount();
    await screen.findByTestId('TxtSummaryContent');
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
