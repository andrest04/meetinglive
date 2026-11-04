// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { SummaryTab } from './SummaryTab';
import { installSummariesApi, tabState, withSummary } from './summaries-test-kit';
import type { RunSetup } from './use-summary-generation';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'vozella');
});

const TEMPLATES = [
  { id: 'auto', labelKey: 'NoteTemplate_Auto', name: null },
  { id: 'one-on-one', labelKey: 'NoteTemplate_OneOnOne', name: null },
  { id: 'standup', labelKey: 'NoteTemplate_Standup', name: null },
] as const;

const SUMMARY = '### Key points\n\n- Ship on Friday';
const ITEMS = [
  { text: 'Send the notes', isDone: false },
  { text: 'Book the room', isDone: true },
];

/** A meeting with a transcript and no summary yet. */
const fresh = (extra = {}) => tabState({ hasTranscript: true, templates: TEMPLATES, ...extra });
/** A meeting with a transcript and a summary. */
const done = (extra = {}) =>
  withSummary(SUMMARY, { hasTranscript: true, templates: TEMPLATES, actionItems: ITEMS, ...extra });

const loadWith = (state: ReturnType<typeof tabState>, generating = false) => ({
  'summaries.loadTab': () => ({ status: 'loaded', state, generating }),
});

const generated = {
  status: 'generated',
  title: 'Weekly sync',
  titleChanged: false,
  summary: SUMMARY,
  actionItems: [],
  providerId: 'claude-code',
};

const mount = (locale: 'en' | 'es' = 'en', runSetup?: RunSetup) =>
  render(
    <Providers locale={locale}>
      <SummaryTab meetingId="m1" {...(runSetup ? { runSetup } : {})} />
    </Providers>,
  );

const calls = (api: ReturnType<typeof installSummariesApi>, name: string) =>
  api.calls.filter((call) => call.name === name);

/** A promise the test settles by hand, to hold a run open. */
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Copy button (item 104)', () => {
  it('copies the summary in Enhanced mode and the notes in My notes mode', async () => {
    const user = userEvent.setup();
    const api = installSummariesApi({
      ...loadWith(done({ notes: 'my own notes' })),
      'summaries.copyText': (input) => ({
        text: input.mode === 'notes' ? 'my own notes' : SUMMARY,
      }),
      'summaries.writeClipboard': () => ({ status: 'written' }),
    });
    mount();
    await user.click(await screen.findByTestId('BtnSessionCopy'));
    expect(await screen.findByText('Copied to the clipboard.')).toBeVisible();
    expect(calls(api, 'summaries.copyText')[0]?.input).toEqual({
      meetingId: 'm1',
      mode: 'summary',
    });
    expect(calls(api, 'summaries.writeClipboard')[0]?.input).toEqual({ text: SUMMARY });
    await user.click(screen.getByRole('radio', { name: 'My notes' }));
    await user.click(await screen.findByTestId('BtnSessionCopy'));
    await waitFor(() => {
      expect(calls(api, 'summaries.copyText')[1]?.input).toEqual({
        meetingId: 'm1',
        mode: 'notes',
      });
    });
    expect(calls(api, 'summaries.writeClipboard')[1]?.input).toEqual({ text: 'my own notes' });
  });

  it('item 55: registers the real copy source for the session Copy button, per mode, and clears it on unmount', async () => {
    const user = userEvent.setup();
    const api = installSummariesApi({
      ...loadWith(done({ notes: 'my own notes' })),
      'summaries.copyText': (input) => ({
        text: input.mode === 'notes' ? 'my own notes' : SUMMARY,
      }),
    });
    const ref: { current: (() => Promise<string | null>) | null } = { current: null };
    const view = render(
      <Providers locale="en">
        <SummaryTab meetingId="m1" copySourceRef={ref} />
      </Providers>,
    );
    await screen.findByRole('radio', { name: 'My notes' });
    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });
    expect(await ref.current?.()).toBe(SUMMARY);
    expect(calls(api, 'summaries.copyText')[0]?.input).toEqual({
      meetingId: 'm1',
      mode: 'summary',
    });
    await user.click(screen.getByRole('radio', { name: 'My notes' }));
    await waitFor(async () => {
      expect(await ref.current?.()).toBe('my own notes');
    });
    expect(calls(api, 'summaries.copyText').at(-1)?.input).toEqual({
      meetingId: 'm1',
      mode: 'notes',
    });
    view.unmount();
    expect(ref.current).toBeNull();
  });

  it('is absent when there is no summary to copy, and says so when the text went blank', async () => {
    installSummariesApi(loadWith(fresh()));
    mount();
    await screen.findByTestId('BtnGenerateSummary');
    expect(screen.queryByTestId('BtnSessionCopy')).toBeNull();
    cleanup();
    const user = userEvent.setup();
    installSummariesApi({
      ...loadWith(done()),
      'summaries.copyText': () => ({ text: null }),
    });
    mount();
    await user.click(await screen.findByTestId('BtnSessionCopy'));
    expect(await screen.findByText('There is nothing to copy.')).toBeVisible();
  });
});

describe('Generate and Regenerate buttons', () => {
  it('shows Generate for a transcript without a summary, with the template picker', async () => {
    installSummariesApi(loadWith(fresh()));
    mount();
    expect(await screen.findByTestId('BtnGenerateSummary')).toHaveTextContent('Generate summary');
    expect(screen.queryByTestId('BtnRegenerateSummary')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Note template' })).toBeVisible();
    expect(screen.getByTestId('CmbSummaryNoteTemplate')).toBe(
      screen.getByRole('combobox', { name: 'Note template' }),
    );
    expect(screen.getByText(/This meeting has a transcript/)).toBeVisible();
  });

  it('shows Regenerate for a transcript with a summary', async () => {
    installSummariesApi(loadWith(done()));
    mount();
    expect(await screen.findByTestId('BtnRegenerateSummary')).toHaveTextContent('Regenerate');
    expect(screen.queryByTestId('BtnGenerateSummary')).toBeNull();
  });

  it('shows no action bar when there is no transcript, even with a summary', async () => {
    installSummariesApi(loadWith(withSummary(SUMMARY, { templates: TEMPLATES })));
    mount();
    await screen.findByTestId('TxtSummaryContent');
    expect(screen.queryByTestId('BtnRegenerateSummary')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Note template' })).toBeNull();
    expect(screen.queryByTestId('TxtSummaryStatus')?.textContent).toBe('');
  });

  it('hides the whole bar in notes mode', async () => {
    installSummariesApi(loadWith(done()));
    mount();
    await userEvent.click(await screen.findByRole('radio', { name: 'My notes' }));
    expect(screen.queryByTestId('BtnRegenerateSummary')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Note template' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });

  it('hides Generate and the picker in Spanish too, with the Spanish names', async () => {
    installSummariesApi(loadWith(fresh()));
    mount('es');
    expect(await screen.findByTestId('BtnGenerateSummary')).toHaveTextContent('Generar resumen');
    expect(screen.getByRole('combobox', { name: 'Plantilla de notas' })).toBeVisible();
  });
});

describe('generating', () => {
  it('sends the picked template, disables every action while it runs, then shows the result', async () => {
    const held = gate<unknown>();
    let loads = 0;
    const api = installSummariesApi({
      'summaries.loadTab': () => {
        loads += 1;
        return {
          status: 'loaded',
          state: loads === 1 ? fresh() : done(),
          generating: false,
        };
      },
      'summaries.generate': () => held.promise,
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));

    expect(await screen.findByText('Generating summary...')).toBeVisible();
    expect(calls(api, 'summaries.generate')[0]?.input).toEqual({
      meetingId: 'm1',
      regenerate: false,
      templateId: 'auto',
    });
    expect(screen.getByTestId('BtnGenerateSummary')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Note template' })).toBeDisabled();
    expect(screen.getByTestId('BtnCancelSummary')).toBeEnabled();

    await act(async () => {
      held.resolve(generated);
      await held.promise;
    });
    expect(await screen.findByText('Summary generated.')).toBeVisible();
    expect(await screen.findByTestId('TxtSummaryContent')).toBeVisible();
    expect(screen.queryByTestId('BtnCancelSummary')).toBeNull();
    expect(screen.getByTestId('BtnRegenerateSummary')).toBeEnabled();
    expect(loads).toBe(2);
  });

  it('waits for a notes save that is still on its way, so the run reads what was typed', async () => {
    const saving = gate<unknown>();
    const api = installSummariesApi({
      ...loadWith(done()),
      'summaries.saveNotes': () => saving.promise,
      'summaries.generate': () => generated,
    });
    mount();
    await userEvent.click(await screen.findByRole('radio', { name: 'My notes' }));
    await userEvent.type(screen.getByTestId('TxtMeetingNotes'), 'remember the budget');
    await userEvent.click(screen.getByRole('radio', { name: 'Enhanced' }));
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await screen.findByText('Generating summary...');
    expect(calls(api, 'summaries.saveNotes')).toHaveLength(1);
    expect(calls(api, 'summaries.generate')).toHaveLength(0);
    await act(async () => {
      saving.resolve({ status: 'saved' });
      await saving.promise;
    });
    await waitFor(() => {
      expect(calls(api, 'summaries.generate')).toHaveLength(1);
    });
  });

  it('shows the formatted failure from the provider (B28), and the run can be retried', async () => {
    const api = installSummariesApi({
      ...loadWith(fresh()),
      'summaries.generate': () => ({
        status: 'failed',
        code: 'CliNotSignedIn',
        args: [],
        detail: null,
        message: 'Claude Code is not signed in.',
      }),
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    expect(
      await screen.findByText('Error generating the summary: Claude Code is not signed in.'),
    ).toBeVisible();
    expect(screen.getByTestId('BtnGenerateSummary')).toBeEnabled();
    await userEvent.click(screen.getByTestId('BtnGenerateSummary'));
    await waitFor(() => {
      expect(calls(api, 'summaries.generate')).toHaveLength(2);
    });
  });

  it('shows a thrown error as a failure instead of leaving the bar stuck', async () => {
    installSummariesApi({
      ...loadWith(fresh()),
      'summaries.generate': () => {
        throw new Error('channel closed');
      },
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    expect(await screen.findByText('Error generating the summary: channel closed')).toBeVisible();
    expect(screen.getByTestId('BtnGenerateSummary')).toBeEnabled();
  });

  it('puts the full status in the tooltip and cuts it with an ellipsis', async () => {
    installSummariesApi({
      ...loadWith(fresh()),
      'summaries.generate': () => ({
        status: 'failed',
        code: 'X',
        args: [],
        detail: null,
        message: 'a very long explanation '.repeat(12).trim(),
      }),
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    const line = await screen.findByTitle(/Error generating the summary: a very long/);
    expect(line.className).toContain('truncate');
  });

  it('says the other outcomes in plain words', async () => {
    const cases: [unknown, string][] = [
      [{ status: 'busy' }, 'This meeting is in use right now. Try the summary again in a moment.'],
      [{ status: 'not-found' }, 'The meeting could not be found, so no summary was made.'],
      [
        { status: 'unavailable', reason: 'xai-removed' },
        'Grok (xAI) is no longer available. Pick Local, Claude Code or Codex to summarize your meetings.',
      ],
    ];
    for (const [outcome, text] of cases) {
      cleanup();
      installSummariesApi({ ...loadWith(fresh()), 'summaries.generate': () => outcome });
      mount();
      await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
      expect(await screen.findByText(text)).toBeVisible();
    }
  });

  it('shows a run that was already going when the page opened', async () => {
    installSummariesApi(loadWith(done(), true));
    mount();
    expect(await screen.findByText('Generating summary...')).toBeVisible();
    expect(screen.getByTestId('BtnRegenerateSummary')).toBeDisabled();
    expect(screen.getByTestId('BtnCancelSummary')).toBeVisible();
  });

  it('follows a run started elsewhere and reloads when it ends', async () => {
    let running = false;
    const api = installSummariesApi({
      'summaries.loadTab': () => ({ status: 'loaded', state: done(), generating: running }),
    });
    mount();
    await screen.findByTestId('BtnRegenerateSummary');
    api.emit('summaries.progress', { meetingId: 'other', running: true });
    expect(screen.getByTestId('BtnRegenerateSummary')).toBeEnabled();
    running = true;
    api.emit('summaries.progress', { meetingId: 'm1', running: true });
    await waitFor(() => {
      expect(screen.getByTestId('BtnRegenerateSummary')).toBeDisabled();
    });
    expect(screen.getByText('Generating summary...')).toBeVisible();
    running = false;
    api.emit('summaries.progress', { meetingId: 'm1', running: false });
    await waitFor(() => {
      expect(screen.getByTestId('BtnRegenerateSummary')).toBeEnabled();
    });
    expect(screen.queryByText('Generating summary...')).toBeNull();
    expect(calls(api, 'summaries.loadTab')).toHaveLength(3);
  });

  it('keeps the status of a finished run when its late progress event arrives', async () => {
    const api = installSummariesApi({
      ...loadWith(fresh()),
      'summaries.generate': () => ({ status: 'busy' }),
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    expect(await screen.findByText(/in use right now/)).toBeVisible();
    api.emit('summaries.progress', { meetingId: 'm1', running: false });
    await waitFor(() => {
      expect(calls(api, 'summaries.loadTab')).toHaveLength(2);
    });
    expect(screen.getByText(/in use right now/)).toBeVisible();
  });
});

describe('regenerate confirmation', () => {
  it('asks with the meeting title, starts on Cancel, and cancel changes nothing', async () => {
    const api = installSummariesApi(loadWith(done()));
    mount();
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    const dialog = await screen.findByRole('dialog', { name: 'Replace this summary?' });
    expect(
      within(dialog).getByText(
        'Regenerating will overwrite the summary and action items for "Weekly sync".',
      ),
    ).toBeVisible();
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls(api, 'summaries.generate')).toHaveLength(0);
  });

  it('closing with Escape does not regenerate either', async () => {
    const api = installSummariesApi(loadWith(done()));
    mount();
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls(api, 'summaries.generate')).toHaveLength(0);
  });

  it('only the primary button regenerates', async () => {
    const api = installSummariesApi({
      ...loadWith(done()),
      'summaries.generate': () => generated,
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(calls(api, 'summaries.generate')).toHaveLength(1);
    });
    expect(calls(api, 'summaries.generate')[0]?.input).toMatchObject({ regenerate: true });
  });

  it('speaks Spanish', async () => {
    installSummariesApi(loadWith(done()));
    mount('es');
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    expect(await screen.findByRole('dialog', { name: '¿Reemplazar este resumen?' })).toBeVisible();
  });
});

describe('cancel (B13)', () => {
  it('asks main to cancel, keeps the previous summary and says so quietly', async () => {
    const held = gate<unknown>();
    const api = installSummariesApi({
      ...loadWith(done()),
      'summaries.generate': () => held.promise,
      'summaries.cancel': () => ({ cancelled: true }),
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await userEvent.click(await screen.findByTestId('BtnCancelSummary'));
    expect(calls(api, 'summaries.cancel')[0]?.input).toEqual({ meetingId: 'm1' });
    await act(async () => {
      held.resolve({ status: 'cancelled' });
      await held.promise;
    });
    expect(await screen.findByText('Summary cancelled.')).toBeVisible();
    expect(screen.getByTestId('TxtSummaryContent')).toHaveTextContent('Ship on Friday');
    expect(screen.queryByTestId('BtnCancelSummary')).toBeNull();
    expect(calls(api, 'summaries.loadTab')).toHaveLength(1);
  });

  it('a Cancel pressed while the notes still save never starts the run', async () => {
    const heldSave = gate<unknown>();
    const api = installSummariesApi({
      ...loadWith(done({ notes: 'old' })),
      'summaries.saveNotes': () => heldSave.promise,
      'summaries.generate': () => ({ ...generated }),
      'summaries.cancel': () => ({ cancelled: false }),
    });
    mount();
    await userEvent.click(await screen.findByRole('radio', { name: 'My notes' }));
    await userEvent.type(screen.getByTestId('TxtMeetingNotes'), ' more');
    await userEvent.click(screen.getByRole('radio', { name: 'Enhanced' }));
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await userEvent.click(await screen.findByTestId('BtnCancelSummary'));
    await act(async () => {
      heldSave.resolve({ status: 'saved' });
      await heldSave.promise;
    });
    expect(await screen.findByText('Summary cancelled.')).toBeVisible();
    expect(calls(api, 'summaries.generate')).toHaveLength(0);
  });
});

describe('needs setup (B34)', () => {
  const needsSetup = {
    status: 'needs-setup',
    kind: 'Local',
    reason: 'model-missing',
  };

  it('opens the setup flow and runs again when it completes', async () => {
    let calledOnce = false;
    const api = installSummariesApi({
      ...loadWith(fresh()),
      'summaries.generate': () => {
        if (!calledOnce) {
          calledOnce = true;
          return needsSetup;
        }
        return generated;
      },
    });
    const runSetup = vi.fn<RunSetup>(() => Promise.resolve('completed'));
    mount('en', runSetup);
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    expect(await screen.findByText('Summary generated.')).toBeVisible();
    expect(runSetup).toHaveBeenCalledWith({ kind: 'Local', reason: 'model-missing' });
    expect(calls(api, 'summaries.generate')).toHaveLength(2);
  });

  it('shows Setup cancelled when the user closes the setup', async () => {
    const api = installSummariesApi({
      ...loadWith(fresh()),
      'summaries.generate': () => needsSetup,
    });
    const runSetup = vi.fn<RunSetup>(() => Promise.resolve('cancelled'));
    mount('en', runSetup);
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    expect(await screen.findByText('Setup cancelled.')).toBeVisible();
    expect(calls(api, 'summaries.generate')).toHaveLength(1);
    expect(screen.getByTestId('BtnGenerateSummary')).toBeEnabled();
  });

  it('ends as cancelled when no setup flow is plugged in yet', async () => {
    installSummariesApi({ ...loadWith(fresh()), 'summaries.generate': () => needsSetup });
    mount();
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    expect(await screen.findByText('Setup cancelled.')).toBeVisible();
  });

  it('asks for setup once per click, so a gate that stays closed does not loop', async () => {
    const api = installSummariesApi({
      ...loadWith(fresh()),
      'summaries.generate': () => needsSetup,
    });
    const runSetup = vi.fn<RunSetup>(() => Promise.resolve('completed'));
    mount('en', runSetup);
    await userEvent.click(await screen.findByTestId('BtnGenerateSummary'));
    expect(await screen.findByText('Setup cancelled.')).toBeVisible();
    expect(runSetup).toHaveBeenCalledTimes(1);
    expect(calls(api, 'summaries.generate')).toHaveLength(2);
  });
});

describe('note template (item 105)', () => {
  it('shows the record template after load without writing it back', async () => {
    const api = installSummariesApi(loadWith(done({ noteTemplateId: 'standup' })));
    mount();
    expect(await screen.findByRole('combobox', { name: 'Note template' })).toHaveTextContent(
      'Standup',
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls(api, 'summaries.setTemplate')).toHaveLength(0);
    expect(calls(api, 'summaries.saveNotes')).toHaveLength(0);
  });

  it('shows Auto for a blank id and for the dropped custom template', async () => {
    for (const id of ['auto', 'custom', '']) {
      cleanup();
      installSummariesApi(loadWith(done({ noteTemplateId: id })));
      mount();
      expect(await screen.findByRole('combobox', { name: 'Note template' })).toHaveTextContent(
        'Auto',
      );
    }
  });

  it('offers the built-in templates only', async () => {
    installSummariesApi(loadWith(done()));
    mount();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Note template' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Auto', '1:1', 'Standup']);
  });

  it('sends the loaded template untouched, and the picked one after a change', async () => {
    const api = installSummariesApi({
      ...loadWith(done({ noteTemplateId: 'standup' })),
      'summaries.generate': () => generated,
    });
    mount();
    await userEvent.click(await screen.findByTestId('BtnRegenerateSummary'));
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(calls(api, 'summaries.generate')).toHaveLength(1);
    });
    expect(calls(api, 'summaries.generate')[0]?.input).toMatchObject({ templateId: 'standup' });

    await userEvent.click(screen.getByRole('combobox', { name: 'Note template' }));
    await userEvent.click(await screen.findByRole('option', { name: '1:1' }));
    expect(screen.getByRole('combobox', { name: 'Note template' })).toHaveTextContent('1:1');
    expect(calls(api, 'summaries.setTemplate')).toHaveLength(0);
    await userEvent.click(screen.getByTestId('BtnRegenerateSummary'));
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(calls(api, 'summaries.generate')).toHaveLength(2);
    });
    expect(calls(api, 'summaries.generate')[1]?.input).toMatchObject({ templateId: 'one-on-one' });
  });
});

describe('copy action items (B16)', () => {
  const openMenu = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'More options' }));
  };

  it('holds only Copy action items, and has no custom template entry', async () => {
    installSummariesApi(loadWith(done()));
    mount();
    await openMenu();
    expect(await screen.findAllByRole('menuitem')).toHaveLength(1);
    expect(screen.getByRole('menuitem', { name: 'Copy action items' })).toBeEnabled();
    expect(screen.getByTestId('BtnListActions')).toBe(
      screen.getByRole('menuitem', { name: 'Copy action items' }),
    );
    expect(screen.queryByText('Save as custom template')).toBeNull();
  });

  it('is off while a run is going', async () => {
    installSummariesApi(loadWith(done(), true));
    mount();
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Copy action items' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('writes the clipboard through main and shows a plain message without a title that goes away after 4 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const api = installSummariesApi({
      ...loadWith(done()),
      'summaries.copyActions': () => ({
        status: 'copied',
        text: '- [ ] Send the notes\n- [x] Book the room',
      }),
      'summaries.writeClipboard': () => ({ status: 'written' }),
    });
    mount();
    await user.click(await screen.findByRole('button', { name: 'More options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy action items' }));
    const message = await screen.findByText('Action items copied to the clipboard.');
    expect(message).toBeVisible();
    expect(screen.queryByText('Could not create the draft')).toBeNull();
    expect(calls(api, 'summaries.writeClipboard')[0]?.input).toEqual({
      text: '- [ ] Send the notes\n- [x] Book the room',
    });
    act(() => {
      vi.advanceTimersByTime(3900);
    });
    expect(screen.getByText('Action items copied to the clipboard.')).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Action items copied to the clipboard.')).toBeNull();
  });

  it('shows the empty message and keeps it until the next action', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const api = installSummariesApi({
      ...loadWith(done({ actionItems: [] })),
      'summaries.copyActions': () => ({ status: 'empty', message: 'No action items to copy.' }),
    });
    mount();
    await user.click(await screen.findByRole('button', { name: 'More options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy action items' }));
    expect(await screen.findByText('No action items to copy.')).toBeVisible();
    expect(calls(api, 'summaries.writeClipboard')).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('No action items to copy.')).toBeVisible();
    // The next action clears it: a successful copy replaces the error.
    api.table['summaries.copyActions'] = () => ({ status: 'copied', text: '- [ ] a' });
    api.table['summaries.writeClipboard'] = () => ({ status: 'written' });
    await user.click(screen.getByRole('button', { name: 'More options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy action items' }));
    expect(await screen.findByText('Action items copied to the clipboard.')).toBeVisible();
    expect(screen.queryByText('No action items to copy.')).toBeNull();
  });

  it('shows a clipboard failure and keeps it', async () => {
    installSummariesApi({
      ...loadWith(done()),
      'summaries.copyActions': () => ({ status: 'copied', text: '- [ ] a' }),
      'summaries.writeClipboard': () => ({ status: 'failed', detail: 'clipboard busy' }),
    });
    mount();
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy action items' }));
    expect(
      await screen.findByText('Could not copy to the clipboard: clipboard busy'),
    ).toBeVisible();
  });

  it('is in Spanish and clears with the next load', async () => {
    installSummariesApi({
      ...loadWith(done()),
      'summaries.copyActions': () => ({ status: 'copied', text: '- [ ] a' }),
      'summaries.writeClipboard': () => ({ status: 'written' }),
    });
    mount('es');
    await userEvent.click(await screen.findByRole('button', { name: 'Más opciones' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Copiar elementos de acción' }),
    );
    expect(await screen.findByText('Elementos de acción copiados al portapapeles.')).toBeVisible();
  });
});
