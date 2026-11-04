// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { TooltipProvider } from '../../ui';
import { SessionRoute } from './SessionRoute';

let summaryText: string | null = 'Summary body';

vi.mock('../summaries/SummaryTab', () => ({
  SummaryTab: ({
    meetingId,
    copySourceRef,
  }: {
    meetingId: string | null;
    copySourceRef?: RefObject<(() => Promise<string | null>) | null>;
  }) => {
    useEffect(() => {
      if (!copySourceRef) return;
      copySourceRef.current = () => Promise.resolve(summaryText);
      return () => {
        copySourceRef.current = null;
      };
    }, [copySourceRef]);
    return <div data-testid="summary-stub">{meetingId}</div>;
  },
}));
vi.mock('./TranscriptTab', () => ({
  TranscriptTab: ({ meetingId }: { meetingId: string }) => (
    <div data-testid="transcript-stub">{meetingId}</div>
  ),
}));
vi.mock('../summaries/use-provider-gate', () => ({
  useProviderGate: () => ({ runSetup: vi.fn() }),
}));
vi.mock('../summaries/ProviderGateDialogs', () => ({
  ProviderGateDialogs: () => null,
  ProviderUnavailableNotice: () => null,
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

type Listener = (payload: unknown) => void;

interface Fake {
  calls: { name: string; input: Record<string, unknown> }[];
  emit(name: string, payload: unknown): void;
  listenerCount(name: string): number;
  titles: Record<string, string | null>;
  state: { selectedMeetingId: string | null; sessionTab: 'Transcript' | 'Summary' };
  revealed: boolean;
  renameStatus: string;
  clipboard: string[];
  failLoad: boolean;
  failState: boolean;
  hasAudio: boolean;
  availability: 'Available' | 'NoAudio' | 'Busy';
  run: { isRunning: boolean; meetingId: string | null; status: string };
  lastResults: { meetingId: string; outcome: string; message: string | null }[];
  delay: Record<string, Promise<void> | undefined>;
}

function install(init: Partial<Fake> = {}): Fake {
  const listeners = new Map<string, Set<Listener>>();
  const fake: Fake = {
    calls: [],
    emit: (name, payload) => {
      for (const l of listeners.get(name) ?? []) l(payload);
    },
    listenerCount: (name) => listeners.get(name)?.size ?? 0,
    titles: { [A]: 'Weekly sync', [B]: 'Other talk' },
    state: { selectedMeetingId: A, sessionTab: 'Transcript' },
    revealed: true,
    renameStatus: 'renamed',
    clipboard: [],
    failLoad: false,
    failState: false,
    hasAudio: true,
    availability: 'Available',
    run: { isRunning: false, meetingId: null, status: '' },
    lastResults: [],
    delay: {},
    ...init,
  };
  const invoke = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    fake.calls.push({ name, input });
    switch (name) {
      case 'workspace.getState':
        if (fake.failState) throw new Error('state gone');
        return { ...fake.state };
      case 'workspace.dispatch': {
        const action = input.action as { type: string; tab?: 'Transcript' | 'Summary' };
        if (action.type === 'setSessionTab' && action.tab) fake.state.sessionTab = action.tab;
        return { state: fake.state };
      }
      case 'session.getView': {
        const id = input.id as string;
        await fake.delay[id];
        if (fake.failLoad) throw new Error('disk gone');
        const title = fake.titles[id];
        return {
          record: title === undefined || title === null ? null : { id, title },
          hasTranscript: true,
          hasAudio: fake.hasAudio,
        };
      }
      case 'session.rename': {
        if (fake.renameStatus === 'renamed') {
          fake.titles[input.id as string] = input.title as string;
        }
        return { status: fake.renameStatus };
      }
      case 'retranscription.availability':
        return { availability: fake.availability };
      case 'retranscription.getState':
        return { ...fake.run, lastResults: fake.lastResults };
      case 'retranscription.dismiss':
        return { dismissed: true };
      case 'session.revealFile':
        return { revealed: fake.revealed };
      case 'summaries.writeClipboard':
        fake.clipboard.push(input.text as string);
        return { status: 'written' };
      default:
        throw new Error(`fake api: unhandled ${name}`);
    }
  };
  Object.defineProperty(window, 'vozella', {
    configurable: true,
    writable: true,
    value: {
      invoke,
      on: (name: string, l: Listener) => {
        const set = listeners.get(name) ?? new Set<Listener>();
        set.add(l);
        listeners.set(name, set);
        return () => {
          set.delete(l);
        };
      },
    },
  });
  return fake;
}

function mount() {
  return render(
    <I18nProvider initialLocale="en">
      <TooltipProvider delay={0}>
        <SessionRoute />
      </TooltipProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  summaryText = 'Summary body';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SessionRoute', () => {
  it('shows a loading skeleton, then the title and the two tabs (2, 15, 16, 25)', async () => {
    const fake = install();
    mount();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Weekly sync' })).toBeTruthy();
    const tabs = within(screen.getByTestId('SelectorSessionTabs')).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Transcript', 'Summary']);
    expect(screen.getByTestId('SelectorSessionTranscript')).toBeTruthy();
    expect(screen.getByTestId('SelectorSessionSummary')).toBeTruthy();
    expect(fake.calls.filter((c) => c.name === 'session.getView')).toHaveLength(1);
  });

  it('opens on the stored tab and stores a user choice for the next meeting (11, 18)', async () => {
    const fake = install({ state: { selectedMeetingId: A, sessionTab: 'Summary' } });
    mount();
    expect(await screen.findByTestId('summary-stub')).toBeTruthy();
    // Applying the stored tab never writes it back (item 11).
    expect(fake.calls.filter((c) => c.name === 'workspace.dispatch')).toEqual([]);
    await userEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
    expect(fake.calls.at(-1)).toEqual({
      name: 'workspace.dispatch',
      input: { action: { type: 'setSessionTab', tab: 'Transcript' } },
    });
    expect(screen.queryByTestId('summary-stub')).toBeNull();
  });

  it('shows the empty state with a Record button when nothing is selected (3, 4, 16)', async () => {
    const fake = install({ state: { selectedMeetingId: null, sessionTab: 'Transcript' } });
    mount();
    expect(await screen.findByText('Open a meeting from Library, or record one.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByTestId('BtnSessionRename')).toBeNull();
    await userEvent.click(screen.getByTestId('BtnSessionEmptyRecord'));
    expect(fake.calls.at(-1)).toEqual({
      name: 'workspace.dispatch',
      input: { action: { type: 'navigateTo', tag: 'Recording' } },
    });
  });

  it('goes back to the Library (24)', async () => {
    const fake = install();
    mount();
    await screen.findByRole('heading', { level: 1 });
    await userEvent.click(screen.getByTestId('BtnSessionBack'));
    expect(fake.calls.at(-1)?.input).toEqual({ action: { type: 'navigateTo', tag: 'History' } });
  });

  it('clears loading and offers Retry when the load throws (8, B9)', async () => {
    const fake = install({ failLoad: true });
    mount();
    expect(await screen.findByText(/could not be opened/i)).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    fake.failLoad = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Weekly sync' })).toBeTruthy();
  });

  it('re-reads the workspace state on Retry when getState itself failed (B9)', async () => {
    const fake = install({ failState: true });
    mount();
    expect(await screen.findByText(/could not be opened/i)).toBeTruthy();
    fake.failState = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Weekly sync' })).toBeTruthy();
    expect(fake.calls.filter((c) => c.name === 'workspace.getState')).toHaveLength(2);
  });

  it('applies slide directions to the panel and clears them on reload (21, B15)', async () => {
    install();
    mount();
    await screen.findByRole('heading', { level: 1 });
    const panelClass = (id: string): string =>
      screen.getByTestId(id).parentElement?.className ?? '';
    expect(panelClass('transcript-stub')).not.toMatch(/animate-slide/);
    await userEvent.click(screen.getByRole('tab', { name: 'Summary' }));
    expect(panelClass('summary-stub')).toContain('animate-slide-from-right');
    await userEvent.click(screen.getByRole('tab', { name: 'Transcript' }));
    expect(panelClass('transcript-stub')).toContain('animate-slide-from-left');
  });

  it('drops to the empty state when the record disappears on meetingChanged (13)', async () => {
    const fake = install();
    mount();
    await screen.findByRole('heading', { level: 1 });
    fake.titles[A] = null;
    act(() => {
      fake.emit('workspace.meetingChanged', { id: A });
    });
    expect(await screen.findByText('Open a meeting from Library, or record one.')).toBeTruthy();
  });

  it('refreshes HasAudio on meetingChanged (13)', async () => {
    const fake = install();
    mount();
    expect(await screen.findByTestId('BtnSessionRetranscribe')).toBeTruthy();
    fake.hasAudio = false;
    act(() => {
      fake.emit('workspace.meetingChanged', { id: A });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('BtnSessionRetranscribe')).toBeNull();
    });
  });

  it('keeps a long title on one truncated line inside the 720 px column (25)', async () => {
    install({ titles: { [A]: 'x'.repeat(200), [B]: 'y' } });
    mount();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.className).toContain('truncate');
    expect(heading.closest('section')?.className).toMatch(/max-w-\[720px\]/);
  });

  it('falls to the empty state when the open meeting is deleted (B20)', async () => {
    const fake = install();
    mount();
    await screen.findByRole('heading', { level: 1 });
    act(() => {
      fake.emit('workspace.meetingDeleted', { id: A });
    });
    expect(await screen.findByText('Open a meeting from Library, or record one.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('refreshes the title on meetingChanged for the open id and ignores others (13)', async () => {
    const fake = install();
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Weekly sync' });
    const before = fake.calls.length;
    act(() => {
      fake.emit('workspace.meetingChanged', { id: B });
    });
    expect(fake.calls.length).toBe(before);
    fake.titles[A] = 'Renamed elsewhere';
    act(() => {
      fake.emit('workspace.meetingChanged', { id: A });
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Renamed elsewhere' }),
    ).toBeTruthy();
  });

  it('drops a stale load when the selection changes meanwhile (14, B6)', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = install({ delay: { [A]: slow } });
    mount();
    await waitFor(() => {
      expect(fake.calls.some((c) => c.name === 'session.getView')).toBe(true);
    });
    act(() => {
      fake.emit('workspace.changed', {
        state: { selectedMeetingId: B, sessionTab: 'Transcript' },
      });
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Other talk' })).toBeTruthy();
    await act(async () => {
      release();
      await slow;
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Other talk' })).toBeTruthy();
    // B6: the tab receives the same id as the header.
    expect(screen.getByTestId('transcript-stub').textContent).toBe(B);
  });

  it('B9: a quiet refresh that fails while the first load is in flight ends in Retry, not empty', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = install({ delay: { [A]: slow } });
    mount();
    await waitFor(() => {
      expect(fake.calls.some((c) => c.name === 'session.getView')).toBe(true);
    });
    fake.failLoad = true;
    act(() => {
      fake.emit('workspace.meetingChanged', { id: A });
    });
    await act(async () => {
      release();
      await slow;
    });
    expect(await screen.findByText(/could not be opened/i)).toBeTruthy();
    expect(screen.queryByText(/Open a meeting from Library/i)).toBeNull();
    fake.failLoad = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Weekly sync' })).toBeTruthy();
  });

  it('unsubscribes on unmount (12)', async () => {
    const fake = install();
    const view = mount();
    await screen.findByRole('heading', { level: 1 });
    const names = [
      'workspace.changed',
      'workspace.meetingChanged',
      'workspace.meetingDeleted',
      'workspace.navigationRequested',
      'retranscription.stateChanged',
      'retranscription.finished',
    ];
    for (const name of names) expect(fake.listenerCount(name)).toBeGreaterThan(0);
    view.unmount();
    for (const name of names) expect(fake.listenerCount(name)).toBe(0);
  });

  describe('rename', () => {
    it('prefills, disables Rename while blank with a hint, and saves trimmed (27 to 35, B13)', async () => {
      const fake = install();
      mount();
      await screen.findByRole('heading', { level: 1 });
      await userEvent.click(screen.getByTestId('BtnSessionRename'));
      const dialog = await screen.findByRole('dialog', { name: 'Rename meeting' });
      const input = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Title' });
      expect(input.value).toBe('Weekly sync');
      const primary = within(dialog).getByRole('button', { name: 'Rename' });
      await userEvent.clear(input);
      expect(primary.hasAttribute('data-disabled') || primary.hasAttribute('disabled')).toBe(true);
      expect(within(dialog).getByText(/enter a name/i)).toBeTruthy();
      await userEvent.type(input, '  Friday plan  ');
      await userEvent.click(primary);
      await waitFor(() => {
        expect(fake.calls.find((c) => c.name === 'session.rename')?.input).toEqual({
          id: A,
          title: 'Friday plan',
        });
      });
      expect(await screen.findByRole('heading', { level: 1, name: 'Friday plan' })).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('remounts the inner tab after a successful rename (35)', async () => {
      install();
      mount();
      await screen.findByRole('heading', { level: 1 });
      const stub = screen.getByTestId('transcript-stub');
      await userEvent.click(screen.getByTestId('BtnSessionRename'));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByRole('textbox'), 'b');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
      await waitFor(() => {
        expect(screen.getByTestId('transcript-stub')).not.toBe(stub);
      });
    });

    it('confirms with Enter and closes with Cancel without renaming (28)', async () => {
      const fake = install();
      mount();
      await screen.findByRole('heading', { level: 1 });
      await userEvent.click(screen.getByTestId('BtnSessionRename'));
      let dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(fake.calls.some((c) => c.name === 'session.rename')).toBe(false);
      await userEvent.click(screen.getByTestId('BtnSessionRename'));
      dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByRole('textbox'), 'z{Enter}');
      await waitFor(() => {
        expect(fake.calls.find((c) => c.name === 'session.rename')?.input).toEqual({
          id: A,
          title: 'Weekly syncz',
        });
      });
    });

    it('stays open and says why when a re-transcription blocks the rename', async () => {
      install({ renameStatus: 'blocked' });
      mount();
      await screen.findByRole('heading', { level: 1 });
      await userEvent.click(screen.getByTestId('BtnSessionRename'));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByRole('textbox'), ' x');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
      expect(await within(dialog).findByText(/re-transcription/i)).toBeTruthy();
    });
  });

  describe('copy', () => {
    it('writes the active tab text and shows Copied for 2.5 s, restarting on each copy (52 to 60)', async () => {
      const fake = install({ state: { selectedMeetingId: A, sessionTab: 'Summary' } });
      mount();
      await screen.findByTestId('summary-stub');
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
      await user.click(screen.getByTestId('BtnSessionCopy'));
      await waitFor(() => {
        expect(fake.clipboard).toEqual(['Summary body']);
      });
      expect(await screen.findByTestId('InfoSessionCopy')).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await user.click(screen.getByTestId('BtnSessionCopy'));
      await waitFor(() => {
        expect(fake.clipboard).toHaveLength(2);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.queryByTestId('InfoSessionCopy')).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(screen.queryByTestId('InfoSessionCopy')).toBeNull();
    });

    it('shows nothing for whitespace text and can be dismissed by hand (56, 60)', async () => {
      const fake = install({ state: { selectedMeetingId: A, sessionTab: 'Summary' } });
      mount();
      await screen.findByTestId('summary-stub');
      summaryText = '   ';
      await userEvent.click(screen.getByTestId('BtnSessionCopy'));
      expect(fake.clipboard).toEqual([]);
      expect(screen.queryByTestId('InfoSessionCopy')).toBeNull();
      summaryText = 'ok';
      await userEvent.click(screen.getByTestId('BtnSessionCopy'));
      const notice = await screen.findByTestId('InfoSessionCopy');
      await userEvent.click(within(notice).getByRole('button', { name: 'Close' }));
      expect(screen.queryByTestId('InfoSessionCopy')).toBeNull();
    });
  });

  describe('open file location', () => {
    it('reveals the file and says nothing on success (61)', async () => {
      const fake = install();
      mount();
      await screen.findByRole('heading', { level: 1 });
      await userEvent.click(screen.getByTestId('BtnSessionOpenLocation'));
      expect(fake.calls.at(-1)).toEqual({ name: 'session.revealFile', input: { id: A } });
      expect(screen.queryByText(/could not open/i)).toBeNull();
    });

    it('shows a quiet notice when the file cannot be opened (62, B13)', async () => {
      install({ revealed: false });
      mount();
      await screen.findByRole('heading', { level: 1 });
      await userEvent.click(screen.getByTestId('BtnSessionOpenLocation'));
      expect(await screen.findByText(/could not open/i)).toBeTruthy();
    });
  });

  describe('re-transcribe in the header', () => {
    it('puts the button in the header actions only when the meeting has audio (89)', async () => {
      install({ hasAudio: false });
      mount();
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByTestId('BtnSessionRetranscribe')).toBeNull();
      cleanup();
      install();
      mount();
      const heading = await screen.findByRole('heading', { level: 1 });
      const header = heading.closest('header');
      if (header === null) throw new Error('the title is not inside the header');
      expect(await within(header).findByTestId('BtnSessionRetranscribe')).toBeEnabled();
    });

    it('disables rename while this meeting is being re-transcribed, not for another one (B4)', async () => {
      const fake = install({
        run: { isRunning: true, meetingId: A, status: 'Transcribing audio... 3%' },
        availability: 'Busy',
      });
      mount();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(screen.getByTestId('BtnSessionRename')).toBeDisabled();
      });
      expect(await screen.findByTestId('TextSessionRetranscribeStatus')).toHaveTextContent('3%');
      cleanup();
      fake.run = { isRunning: true, meetingId: B, status: 'x' };
      mount();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        expect(screen.getByTestId('BtnSessionRename')).toBeEnabled();
      });
      expect(screen.queryByTestId('TextSessionRetranscribeStatus')).toBeNull();
    });

    it('shows the kept result when the page opens after the run ended elsewhere (B7)', async () => {
      install({ lastResults: [{ meetingId: A, outcome: 'Completed', message: null }] });
      mount();
      expect(await screen.findByTestId('InfoSessionRetranscribeNotice')).toHaveTextContent(
        'Re-transcribed.',
      );
    });

    it('re-reads the record and both tabs after a run ends (143, 22)', async () => {
      const fake = install();
      mount();
      await screen.findByRole('heading', { level: 1 });
      const before = fake.calls.filter((c) => c.name === 'session.getView').length;
      const stub = screen.getByTestId('transcript-stub');
      act(() => {
        fake.emit('retranscription.finished', {
          meetingId: A,
          outcome: 'Completed',
          message: null,
        });
      });
      await waitFor(() => {
        expect(fake.calls.filter((c) => c.name === 'session.getView').length).toBeGreaterThan(
          before,
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId('transcript-stub')).not.toBe(stub);
      });
    });
  });
});
