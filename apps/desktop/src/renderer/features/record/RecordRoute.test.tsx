// @vitest-environment jsdom
import type { RecordingSetupDto, RecordingStateDto } from '@vozella/contracts';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { RecordRoute } from './RecordRoute';
import { applyAnswer, resetLiveAskStore } from './use-live-ask';
import { resetRecordingStore } from './use-recording';

type Listener = (payload: unknown) => void;
type Handler = (input: Record<string, unknown>) => unknown;

const system = { processId: null, app: null, isAvailable: true, level: 0 };
const pickerState = {
  cards: [system],
  selectedProcessId: null,
  noAppsPlaying: true,
  fallbackAppName: null,
};

const idleState: RecordingStateDto = {
  phase: 'Idle',
  isRecording: false,
  isPaused: false,
  isProcessing: false,
  elapsedMs: 0,
  elapsedAsOfMs: 0,
  isTicking: false,
  status: [],
  micLevel: 0,
  microphoneActive: true,
  captureNotices: [],
  meetingId: null,
  title: '',
  recordedAtMs: null,
  highlightCount: 0,
  notes: '',
  canRetry: false,
  lastMeeting: null,
};

const card = (header: string, ready: boolean) => ({
  headerKey: header,
  status: { key: ready ? 'RecordingSetup_Ready' : 'RecordingSetup_NeedsSetup', args: [] },
  detail: { key: 'RecordingSetup_EngineDetail', args: [] },
  ready,
});

const readySetup: RecordingSetupDto = {
  canRecord: true,
  live: card('RecordingSetup_Live.Header', true),
  engine: card('RecordingSetup_Engine.Header', true),
  summary: card('RecordingSetup_Summary.Header', true),
  summaryProviderRemoved: false,
  idleStatus: { key: 'Status_ReadyToRecord', args: [] },
  provider: 'Local',
};

const needsSetup: RecordingSetupDto = {
  ...readySetup,
  canRecord: false,
  engine: card('RecordingSetup_Engine.Header', false),
  idleStatus: { key: 'Status_NeedsSetup', args: [] },
};

const folder = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  parentId,
  note: null,
  colorKey: null,
  iconKey: null,
  createdAt: '2026-09-01T12:00:00+00:00',
});

function installApi(overrides: Record<string, Handler> = {}) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Map<string, Set<Listener>>();
  const handlers: Record<string, Handler> = {
    'audio.microphones.load': () => ({
      options: [
        { kind: 'None', deviceId: null, name: null },
        { kind: 'SystemDefault', deviceId: null, name: null },
      ],
      selected: { kind: 'SystemDefault', deviceId: null },
    }),
    'audio.sources.start': () => pickerState,
    'transcription.getStatus': () => ({ ready: true, liveEnabled: false }),
    'recording.getState': () => ({ ...idleState, liveText: '' }),
    'recording.getSetup': () => readySetup,
    'library.load': () => ({
      ok: true,
      folders: [folder('f-b', 'beta'), folder('f-a', 'Alpha'), folder('f-c', 'Child', 'f-a')],
      meetings: [],
      skipped: [],
    }),
    'recording.start': () => ({ started: true, meetingId: 'm1', recordedAtMs: 1 }),
    'recording.stop': () => ({ stopped: true }),
    ...overrides,
  };
  const invoke = (name: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, input });
    const handler = handlers[name];
    return Promise.resolve(handler ? handler(input) : {});
  };
  const on = (name: string, listener: Listener) => {
    const set = listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    listeners.set(name, set);
    return () => {
      set.delete(listener);
    };
  };
  Object.defineProperty(window, 'vozella', {
    value: { invoke, on },
    configurable: true,
    writable: true,
  });
  const emit = (name: string, payload: unknown): void => {
    act(() => {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    });
  };
  const named = (name: string) => calls.filter((call) => call.name === name);
  return { calls, emit, named };
}

beforeEach(() => {
  resetRecordingStore();
  resetLiveAskStore();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = () =>
  render(
    <Providers>
      <RecordRoute />
    </Providers>,
  );

describe('RecordRoute idle zone (spec 2.1, 2.2)', () => {
  it('shows the default title, the destination list and the hero when ready', async () => {
    installApi();
    mount();
    expect(await screen.findByRole('button', { name: 'Record' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Import audio' })).toBeEnabled();
    expect(screen.queryByTestId('setup-checklist')).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' }).value).toMatch(
      /^Meeting \d{1,2} \w{3}, \d{2}:\d{2}$/,
    );
    expect(await screen.findByText('Ready to record.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Save to' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['Inbox', 'Alpha', 'Alpha / Child', 'beta']);
  });

  it('starts with the typed title, the chosen destination and the chosen sources', async () => {
    const api = installApi();
    mount();
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Weekly');
    await userEvent.click(screen.getByRole('combobox', { name: 'Save to' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Alpha / Child' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => {
      expect(api.named('recording.start')).toHaveLength(1);
    });
    expect(api.named('recording.start')[0]?.input).toEqual({
      title: 'Weekly',
      folderId: 'f-c',
      microphone: { kind: 'SystemDefault', deviceId: null },
      processId: null,
      appName: null,
    });
    // The readiness was read again before the start (item 18).
    expect(api.named('recording.getSetup').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the destination across visits while the folder exists, else the Inbox', async () => {
    installApi();
    const first = mount();
    await userEvent.click(await screen.findByRole('combobox', { name: 'Save to' }));
    await userEvent.click(await screen.findByRole('option', { name: 'beta' }));
    expect(screen.getByRole('combobox', { name: 'Save to' })).toHaveTextContent('beta');
    first.unmount();
    installApi({
      'library.load': () => ({
        ok: true,
        folders: [folder('f-b', 'beta')],
        meetings: [],
        skipped: [],
      }),
    });
    mount();
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Save to' })).toHaveTextContent('beta');
    });
    cleanup();
    installApi({ 'library.load': () => ({ ok: true, folders: [], meetings: [], skipped: [] }) });
    mount();
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Save to' })).toHaveTextContent('Inbox');
    });
  });

  it.each([
    [false, 'The live preview is off. The transcript is made after you stop.'],
    [true, /Live preview only/],
  ])(
    '105: with live transcription %s the empty canvas says the matching thing',
    async (liveEnabled, hint) => {
      installApi({
        'transcription.getStatus': () => ({ ready: true, liveEnabled }),
        'recording.getState': () => ({
          ...idleState,
          phase: 'Recording',
          isRecording: true,
          liveText: '',
        }),
      });
      mount();
      expect(await screen.findByText(hint)).toBeInTheDocument();
    },
  );

  it('shows the title in the bar while recording, with the fields out of the way, and unlocks the title while processing', async () => {
    installApi({
      'recording.getState': () => ({
        ...idleState,
        phase: 'Recording',
        isRecording: true,
        title: 'Live take',
        liveText: '',
      }),
    });
    const view = mount();
    await waitFor(() => {
      expect(screen.getByTestId('bar-title')).toHaveTextContent('Live take');
    });
    // The fields stay mounted so the sources keep their state, but are not drawn.
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Save to' })).toBeNull();
    view.unmount();
    installApi({
      'recording.getState': () => ({
        ...idleState,
        phase: 'Processing',
        isProcessing: true,
        liveText: '',
      }),
    });
    resetRecordingStore();
    mount();
    await screen.findByTestId('record-session');
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeEnabled();
  });

  it('draws a new default title when the take ends (spec 2.2)', async () => {
    const api = installApi();
    mount();
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'First take');
    api.emit('recording.state', { ...idleState, phase: 'Processing', isProcessing: true });
    api.emit('recording.state', idleState);
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Title' }).value).toMatch(
        /^Meeting /,
      );
    });
  });
});

describe('RecordRoute idle document (the title is the heading)', () => {
  const subtitle = /Set up your meeting, then record it/;

  it('keeps one h1 for assistive tech, no subtitle and an unlabeled but named title', async () => {
    installApi();
    mount();
    const title = await screen.findByRole('textbox', { name: 'Title' });
    expect(title).toBeEnabled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Record meeting' })).toBeInTheDocument();
    expect(screen.queryByText(subtitle)).toBeNull();
    expect(screen.queryByText('Title')).toBeNull();
  });

  it('shows the destination as one visible label and a select', async () => {
    installApi();
    mount();
    await screen.findByRole('combobox', { name: 'Save to' });
    expect(screen.getAllByText('Save to')).toHaveLength(1);
  });

  it('keeps the subtitle and the labeled fields while processing', async () => {
    installApi({
      'recording.getState': () => ({
        ...idleState,
        phase: 'Processing',
        isProcessing: true,
        liveText: '',
      }),
    });
    mount();
    await screen.findByTestId('record-session');
    expect(screen.getByRole('heading', { level: 1, name: 'Record meeting' })).toBeInTheDocument();
    expect(screen.getByText(subtitle)).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeEnabled();
  });
});

describe('RecordRoute action row', () => {
  const helper = 'Transcript and summary are created after you stop.';

  it('holds Record, Import and the helper when ready', async () => {
    installApi();
    mount();
    const row = await screen.findByTestId('record-actions');
    expect(within(row).getByTestId('record-hero')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Record' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: 'Import audio' })).toBeEnabled();
    expect(within(row).getByText(helper)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Set up to record' })).toBeNull();
  });

  it('holds only Set up to record while setup is missing', async () => {
    installApi({ 'recording.getSetup': () => needsSetup });
    mount();
    const panel = await screen.findByTestId('setup-checklist');
    const row = screen.getByTestId('record-actions');
    expect(within(row).getByRole('button', { name: 'Set up to record' })).toBeEnabled();
    expect(within(panel).queryByRole('button', { name: 'Set up to record' })).toBeNull();
    expect(within(row).queryByTestId('record-hero')).toBeNull();
    expect(screen.queryByText(helper)).toBeNull();
  });

  it('sits after the result card and the saved transcript, so it stays reachable below them', async () => {
    installApi({
      'recording.getState': () => ({
        ...idleState,
        lastMeeting: { id: 'm-9', title: 'Weekly sync' },
        liveText: 'Hello there',
      }),
    });
    mount();
    const row = await screen.findByTestId('record-actions');
    const transcript = await screen.findByTestId('saved-transcript');
    expect(transcript.compareDocumentPosition(row)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('is not drawn during a take or while processing', async () => {
    installApi({
      'recording.getState': () => ({
        ...idleState,
        phase: 'Processing',
        isProcessing: true,
        liveText: '',
      }),
    });
    mount();
    await screen.findByTestId('record-session');
    expect(screen.queryByTestId('record-actions')).toBeNull();
  });

  it('keeps a refusal next to the button that caused it', async () => {
    installApi({
      'recording.start': () => ({
        started: false,
        reason: 'failed',
        message: { key: 'Error_StartRecording', args: ['disk full'], severity: 'error' },
      }),
    });
    mount();
    const row = await screen.findByTestId('record-actions');
    await userEvent.click(within(row).getByRole('button', { name: 'Record' }));
    expect(await within(row).findByRole('alert')).toHaveTextContent('disk full');
  });
});

describe('RecordRoute setup (spec 2.4, items 14 to 18)', () => {
  it('shows the inline panel with the three cards instead of the hero', async () => {
    installApi({ 'recording.getSetup': () => needsSetup });
    mount();
    const panel = await screen.findByTestId('setup-checklist');
    expect(within(panel).getAllByTestId('setup-card')).toHaveLength(3);
    expect(within(panel).getByText('Needs setup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up to record' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import audio' })).toBeNull();
    expect(screen.getByText('Set up recording before you start.')).toBeInTheDocument();
  });

  it('names the rows by what they do', async () => {
    installApi({
      'recording.getSetup': () => ({
        ...needsSetup,
        live: {
          ...card('RecordingSetup_Live.Header', false),
          detail: { key: 'RecordingSetup_LiveNotNeededDetail', args: [] },
        },
      }),
    });
    mount();
    const panel = await screen.findByTestId('setup-checklist');
    const [live, engine] = within(panel).getAllByTestId('setup-card');
    expect(live).toHaveTextContent('Live captions');
    expect(live).toHaveTextContent(
      'Live captions are off. The transcript is still created after you stop.',
    );
    expect(engine).toHaveTextContent('Transcript');
    expect(panel).not.toHaveTextContent('Nemo');
  });

  it('asks the removed provider to be replaced', async () => {
    installApi({
      'recording.getSetup': () => ({
        ...needsSetup,
        summaryProviderRemoved: true,
        provider: 'Xai',
      }),
    });
    mount();
    expect(await screen.findByTestId('TxtProviderUnavailable')).toHaveTextContent(
      'Grok (xAI) is no longer available',
    );
  });

  it('item 16: a refused Record opens the dialog, and Cancel leaves everything as it was', async () => {
    let setup = readySetup;
    const api = installApi({ 'recording.getSetup': () => setup });
    mount();
    await screen.findByRole('button', { name: 'Record' });
    setup = needsSetup;
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up recording' });
    expect(within(dialog).getByRole('button', { name: 'Set up' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.named('recording.start')).toHaveLength(0);
    expect(await screen.findByText('Setup cancelled.')).toBeInTheDocument();
  });

  it('item 17: Set up runs the engine step first, then the loop reads the snapshot again and records', async () => {
    let setup = needsSetup;
    const api = installApi({
      'recording.getSetup': () => setup,
      'transcription.ensureEngine': () => {
        setup = readySetup;
        return { status: 'ready' };
      },
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Set up to record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up recording' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set up' }));
    await waitFor(() => {
      expect(api.named('transcription.ensureEngine').length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('setup-checklist')).toBeNull();
  });
});

describe('RecordRoute accelerator and missing steps', () => {
  it('item 62: Ctrl+R starts a take on the idle page', async () => {
    const api = installApi();
    mount();
    await screen.findByRole('button', { name: 'Record' });
    await userEvent.keyboard('{Control>}r{/Control}');
    await waitFor(() => {
      expect(api.named('recording.start')).toHaveLength(1);
    });
  });

  it('item 17: with the engine ready, the summary chooser is the next step and cancelling it loops back to the checklist', async () => {
    const needsSummary: RecordingSetupDto = {
      ...readySetup,
      canRecord: false,
      summary: card('RecordingSetup_Summary.Header', false),
      idleStatus: { key: 'Status_NeedsSetup', args: [] },
    };
    const api = installApi({ 'recording.getSetup': () => needsSummary });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Set up to record' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set up recording' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set up' }));
    const wizard = await screen.findByRole('dialog', { name: 'Set up summary generation' });
    expect(api.named('transcription.ensureEngine')).toHaveLength(0);
    await userEvent.click(within(wizard).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Set up recording' })).toBeInTheDocument();
    expect(api.named('recording.start')).toHaveLength(0);
  });
});

describe('RecordRoute status bars (spec 2.18, B-12)', () => {
  it('shows the start refusal as an error bar by its typed severity', async () => {
    installApi({
      'recording.start': () => ({
        started: false,
        reason: 'failed',
        message: { key: 'Error_StartRecording', args: ['disk full'], severity: 'error' },
      }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Record' }));
    const bar = await screen.findByRole('alert');
    expect(bar).toHaveTextContent('Something went wrong');
    expect(bar).toHaveTextContent('disk full');
    expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();
  });

  it('does not treat text that starts with Error as an error when the severity is info', async () => {
    const api = installApi();
    mount();
    await screen.findByRole('button', { name: 'Record' });
    api.emit('recording.state', {
      ...idleState,
      status: [{ key: 'Error_ImportAudio', args: ['only a note'], severity: 'info' }],
    });
    expect(await screen.findByText(/only a note/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('97, B-24: the idle column shows the soft warning after a take, as a caption', async () => {
    const api = installApi();
    mount();
    await screen.findByRole('button', { name: 'Record' });
    api.emit('recording.state', {
      ...idleState,
      status: [
        { key: 'Status_Done', args: [], severity: 'info' },
        { key: 'Warning_MicrophoneLost', args: [], severity: 'warning' },
      ],
    });
    expect(await screen.findByText(/The microphone stopped working/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error bar during a session too, with the whole status', async () => {
    const api = installApi();
    mount();
    await screen.findByRole('button', { name: 'Record' });
    api.emit('recording.state', {
      ...idleState,
      phase: 'Processing',
      isProcessing: true,
      status: [
        { key: 'Error_OutputCaptureFailed', args: ['gone'], severity: 'error' },
        { key: 'Status_Transcribing', args: [], severity: 'info' },
      ],
    });
    const bar = await screen.findByRole('alert');
    expect(bar).toHaveTextContent('Something went wrong');
    expect(bar).toHaveTextContent('Transcribing audio...');
  });
});

describe('RecordRoute result card (spec 2.13, item 183)', () => {
  const saved = { ...idleState, lastMeeting: { id: 'm-9', title: 'Weekly sync' } };

  it('opens the Summary tab when the meeting has a summary', async () => {
    const api = installApi({
      'recording.getState': () => ({ ...saved, liveText: 'Hello there' }),
      'library.getMeeting': () => ({ record: { summary: 'A summary' } }),
    });
    mount();
    const card = await screen.findByTestId('result-card');
    expect(card).toHaveTextContent('Weekly sync');
    expect(screen.getByTestId('saved-transcript')).toHaveTextContent('Hello there');
    await userEvent.click(within(card).getByRole('button', { name: 'Open' }));
    const opened = () =>
      api
        .named('workspace.dispatch')
        .filter(
          (c) =>
            JSON.stringify(c.input).includes('Session') ||
            JSON.stringify(c.input).includes('selectMeeting'),
        );
    await waitFor(() => {
      expect(opened()).toHaveLength(2);
    });
    expect(opened().map((call) => call.input)).toEqual([
      { action: { type: 'selectMeeting', id: 'm-9' } },
      { action: { type: 'openSession', tab: 'Summary' } },
    ]);
  });

  it('opens the Transcript tab when there is no summary', async () => {
    const api = installApi({
      'recording.getState': () => ({ ...saved, liveText: '' }),
      'library.getMeeting': () => ({ record: { summary: null } }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(api.named('workspace.dispatch').length).toBeGreaterThanOrEqual(3);
    });
    expect(api.named('workspace.dispatch').at(-1)?.input).toEqual({
      action: { type: 'openSession', tab: 'Transcript' },
    });
  });

  it('clears when the workspace reports the meeting deleted', async () => {
    const api = installApi({ 'recording.getState': () => ({ ...saved, liveText: '' }) });
    mount();
    await screen.findByTestId('result-card');
    api.emit('workspace.meetingDeleted', { id: 'm-9' });
    await waitFor(() => {
      expect(screen.queryByTestId('result-card')).toBeNull();
    });
  });
});

describe('RecordRoute import (spec 2.12)', () => {
  it('picks a file, then imports it into the chosen destination', async () => {
    const api = installApi({
      'audio.import.pickFile': () => ({ path: 'C:\\in\\call.mp3', recordedAtMs: 5 }),
      'recording.import': () => ({ started: true, meetingId: 'm2' }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Import audio' }));
    await waitFor(() => {
      expect(api.named('recording.import')).toHaveLength(1);
    });
    expect(api.named('recording.import')[0]?.input).toMatchObject({
      folderId: null,
      path: 'C:\\in\\call.mp3',
    });
  });

  it('stays silent when the picker is cancelled and shows a refusal otherwise', async () => {
    let picked: unknown = null;
    installApi({
      'audio.import.pickFile': () => picked,
      'recording.import': () => ({
        started: false,
        reason: 'failed',
        message: { key: 'Error_ImportAudio', args: ['bad file'], severity: 'error' },
      }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Import audio' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import audio' })).toBeEnabled();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    picked = { path: 'C:\\in\\x.wav', recordedAtMs: 1 };
    await userEvent.click(screen.getByRole('button', { name: 'Import audio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('bad file');
  });
});

describe('RecordRoute take notes request', () => {
  it('starts a blank recording when the request is pending and the page is idle', async () => {
    const api = installApi({
      'workspace.dispatch': () => ({
        state: {},
        takeNotes: { pending: true, calendarEventId: null },
      }),
    });
    mount();
    await waitFor(() => {
      expect(api.named('recording.start')).toHaveLength(1);
    });
  });
});

describe('RecordRoute processing (spec 2.10, 2.11, items 163 and 154)', () => {
  const processing = {
    ...idleState,
    phase: 'Processing' as const,
    isProcessing: true,
    status: [{ key: 'Status_Transcribing', args: [], severity: 'info' as const }],
  };

  it('shows the status in a polite live region, an indeterminate bar and an enabled Cancel', async () => {
    const api = installApi({
      'recording.getState': () => ({ ...processing, liveText: '' }),
      'recording.cancelProcessing': () => ({ cancelled: true }),
    });
    mount();
    const status = await screen.findByTestId('recording-status');
    expect(status).toHaveTextContent('Transcribing audio...');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: 'Cancel transcription or summary' });
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveTextContent('Cancel');
    await userEvent.click(cancel);
    expect(api.named('recording.cancelProcessing')[0]?.input).toEqual({ meetingId: null });
  });

  it('B-21: a quiet Cancel summary appears on the result card only while the summary runs', async () => {
    const api = installApi({
      'recording.getState': () => ({
        ...idleState,
        lastMeeting: { id: 'm-9', title: 'Weekly sync' },
        status: [{ key: 'Status_GeneratingSummary', args: [], severity: 'info' }],
        liveText: '',
      }),
      'recording.cancelProcessing': () => ({ cancelled: true }),
    });
    mount();
    const card = await screen.findByTestId('result-card');
    await userEvent.click(within(card).getByRole('button', { name: 'Cancel summary' }));
    expect(api.named('recording.cancelProcessing')[0]?.input).toEqual({ meetingId: 'm-9' });
    expect(screen.queryByTestId('BtnCancelProcessing')).toBeNull();
  });

  it('shows no Cancel summary once the summary is done', async () => {
    installApi({
      'recording.getState': () => ({
        ...idleState,
        lastMeeting: { id: 'm-9', title: 'Weekly sync' },
        status: [{ key: 'Status_Done', args: [], severity: 'info' }],
        liveText: '',
      }),
    });
    mount();
    await screen.findByTestId('result-card');
    expect(screen.queryByRole('button', { name: 'Cancel summary' })).toBeNull();
  });

  it('B-11: a failed first save offers Try saving again, which runs retryProcessing', async () => {
    const api = installApi({
      'recording.getState': () => ({
        ...idleState,
        canRetry: true,
        status: [{ key: 'Error_ProcessRecording', args: ['disk full'], severity: 'error' }],
        liveText: '',
      }),
      'recording.retryProcessing': () => ({ started: true }),
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Try saving again' }));
    expect(api.named('recording.retryProcessing')).toHaveLength(1);
  });

  it('offers no retry when nothing can be retried', async () => {
    installApi();
    mount();
    await screen.findByRole('button', { name: 'Record' });
    expect(screen.queryByRole('button', { name: 'Try saving again' })).toBeNull();
  });
});

describe('RecordRoute live ask (spec 2.8, items 113 and 128)', () => {
  const recording = {
    ...idleState,
    phase: 'Recording' as const,
    isRecording: true,
    title: 'Live take',
  };
  const answerOf = (extra: Record<string, unknown>) => ({
    isAnswering: false,
    text: '',
    error: null,
    usedWeb: false,
    canUseWebSearch: true,
    ...extra,
  });

  it('shows the dock under the transcript and the answer card beside it', async () => {
    installApi({ 'recording.getState': () => ({ ...recording, liveText: '' }) });
    mount();
    const box = await screen.findByRole('textbox', { name: 'Type a question' });
    expect(box).toHaveAttribute('id', 'TxtLiveAsk');
    expect(box).toHaveAttribute('placeholder', 'Type a question, then press Ctrl+Enter');
    expect(screen.queryByTestId('answer-card')).toBeNull();
    act(() => {
      applyAnswer(answerOf({ text: 'Because of the budget.', usedWeb: true }));
    });
    const card = screen.getByTestId('answer-card');
    expect(within(card).getByRole('heading', { name: 'Answer' })).toBeInTheDocument();
    expect(card).toHaveTextContent('Because of the budget.');
    expect(card).toHaveTextContent('Searched the web');
  });

  it('has no dock outside a recording and no armed question controls', async () => {
    installApi();
    mount();
    await screen.findByRole('button', { name: 'Record' });
    expect(screen.queryByRole('textbox', { name: 'Type a question' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss the detected question' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Answer the detected question' })).toBeNull();
  });
});
