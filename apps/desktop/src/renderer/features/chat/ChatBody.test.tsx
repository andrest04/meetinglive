// @vitest-environment jsdom
import type { ChatSendOutcomeDto, ChatStateDto } from '@vozella/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { DialogHost } from '../shell/dialog-service';
import { ChatBody } from './ChatBody';

vi.mock('../summaries/ProviderGateDialogs', () => ({
  ProviderGateDialogs: ({
    gate,
  }: {
    gate: { open: { surface: string } | null; finish: (ok: boolean) => void };
  }) =>
    gate.open ? (
      <div data-testid="GateStub" data-open={JSON.stringify(gate.open)}>
        <button
          type="button"
          onClick={() => {
            gate.finish(true);
          }}
        >
          gate done
        </button>
        <button
          type="button"
          onClick={() => {
            gate.finish(false);
          }}
        >
          gate cancel
        </button>
      </div>
    ) : null,
}));

type Listener = (payload: unknown) => void;

const ALL = { isVisible: true, kind: 'AllMeetings', folderId: null, meetingId: null } as const;
const MEETING = { isVisible: true, kind: 'Meeting', folderId: null, meetingId: 'm1' } as const;
const LIVE = { isVisible: true, kind: 'Live', folderId: null, meetingId: null } as const;

const msg = (id: string, role: 'user' | 'assistant', text: string) => ({
  id,
  role,
  text,
  createdAt: '2026-09-01T09:00:00Z',
});

const stateOf = (over: Partial<ChatStateDto> = {}): ChatStateDto => ({
  messages: [],
  isSending: false,
  showScopeMismatch: false,
  hasMessages: false,
  canStartNewChat: true,
  attachments: [],
  ...over,
});

interface Api {
  sends: { requestId: string; draft: string; liveTranscript: string | null }[];
  emit: (name: string, payload: unknown) => void;
  calls: string[];
  inputs: { name: string; input: Record<string, unknown> }[];
}

function install(options: {
  state?: ChatStateDto;
  /** Action items of the scoped meeting; undefined answers no record. */
  actionItems?: () => { text: string; isDone: boolean }[];
  send?: (n: number, input: { requestId: string; draft: string }) => Promise<ChatSendOutcomeDto>;
  beforeSend?: () => Promise<void>;
  copy?: () => { status: 'written' } | { status: 'failed'; detail: string };
  replace?: (input: Record<string, unknown>) => unknown;
}): Api {
  const listeners = new Map<string, Set<Listener>>();
  const api: Api = {
    sends: [],
    calls: [],
    inputs: [],
    emit: (name, payload) => {
      listeners.get(name)?.forEach((listener) => {
        listener(payload);
      });
    },
  };
  const invoke = vi.fn(async (name: string, input: Record<string, unknown>) => {
    api.calls.push(name);
    api.inputs.push({ name, input });
    switch (name) {
      case 'chat.state':
        return options.state ?? stateOf();
      case 'workspace.getState':
        await options.beforeSend?.();
        return { liveTranscript: 'live words' };
      case 'chat.send': {
        const typed = input as { requestId: string; draft: string; liveTranscript: string | null };
        api.sends.push(typed);
        return (
          options.send?.(api.sends.length, typed) ??
          ({
            status: 'answered',
            user: msg('u1', 'user', typed.draft),
            assistant: msg('a1', 'assistant', 'Fine **answer**'),
            notice: null,
          } satisfies ChatSendOutcomeDto)
        );
      }
      case 'chat.cancel':
        return { cancelled: true };
      case 'summaries.replaceSummary':
        return (
          options.replace?.(input) ?? {
            status: 'saved',
            previous: { summary: 'Old.', actionItems: [{ text: 'Keep', isDone: true }] },
          }
        );
      case 'chat.copyText':
        return options.copy?.() ?? { status: 'written' };
      case 'library.getMeeting':
        return {
          record: options.actionItems ? { id: input.id, actionItems: options.actionItems() } : null,
        };
      default:
        throw new Error(`unhandled ${name}`);
    }
  });
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke,
      on: (name: string, listener: Listener) => {
        const set = listeners.get(name) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(name, set);
        return () => {
          set.delete(listener);
        };
      },
    },
    configurable: true,
    writable: true,
  });
  return api;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = (
  scope: typeof ALL | typeof MEETING | typeof LIVE = ALL,
  locale: 'en' | 'es' = 'en',
) =>
  render(
    <Providers locale={locale}>
      <DialogHost>
        <ChatBody scope={scope} />
      </DialogHost>
    </Providers>,
  );

const box = () => screen.getByTestId<HTMLTextAreaElement>('TxtMeetingChat');
const sendButton = () => screen.getByTestId<HTMLButtonElement>('BtnMeetingChatSend');

/** A send that stays open until the test settles it. */
function deferred() {
  let settle!: (outcome: ChatSendOutcomeDto) => void;
  const promise = new Promise<ChatSendOutcomeDto>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('composer keys (items 28 to 31, S1)', () => {
  it('Enter sends and clears the draft; the answer renders as Markdown', async () => {
    const api = install({});
    mount();
    await userEvent.type(box(), 'What did we decide?{Enter}');
    await waitFor(() => {
      expect(screen.getByText('answer').tagName).toBe('STRONG');
    });
    expect(api.sends[0]?.draft).toBe('What did we decide?');
    expect(api.sends[0]?.liveTranscript).toBe('live words');
    expect(box().value).toBe('');
  });

  it('Shift+Enter adds a line and does not send', async () => {
    const api = install({});
    mount();
    await userEvent.type(box(), 'one{Shift>}{Enter}{/Shift}two');
    expect(box().value).toBe('one\ntwo');
    expect(api.sends).toHaveLength(0);
  });

  it('Ctrl+Enter sends', async () => {
    const api = install({});
    mount();
    await userEvent.type(box(), 'hi{Control>}{Enter}{/Control}');
    await waitFor(() => {
      expect(api.sends).toHaveLength(1);
    });
  });

  it('Enter on an empty draft sends nothing and inserts no line', async () => {
    const api = install({});
    mount();
    await userEvent.type(box(), '{Enter}');
    expect(box().value).toBe('');
    expect(api.sends).toHaveLength(0);
  });

  it('Enter during IME composition is ignored (S1)', () => {
    const api = install({});
    mount();
    fireEvent.change(box(), { target: { value: 'konnichiwa' } });
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
    expect(api.sends).toHaveLength(0);
  });

  it('Enter while an answer runs does nothing', async () => {
    const open = deferred();
    const api = install({ send: () => open.promise });
    mount();
    await userEvent.type(box(), 'first{Enter}');
    await waitFor(() => {
      expect(api.sends).toHaveLength(1);
    });
    await userEvent.type(box(), 'second{Enter}');
    expect(api.sends).toHaveLength(1);
    expect(box().value).toBe('second');
    await act(async () => {
      open.settle({ status: 'cancelled', originalDraft: 'first' });
      await Promise.resolve();
    });
  });
});

describe('send button (item 32)', () => {
  it('is enabled only for a non-blank draft and names its shortcut', async () => {
    install({});
    mount();
    expect(sendButton().disabled).toBe(true);
    await userEvent.type(box(), '   ');
    expect(sendButton().disabled).toBe(true);
    await userEvent.type(box(), 'x');
    expect(sendButton().disabled).toBe(false);
    expect(sendButton().getAttribute('aria-label')).toBe('Send');
  });
});

describe('optimistic rows, rollback and draft restore (items 33 to 35, 44)', () => {
  it('shows the user row and Thinking at once, then the streamed text', async () => {
    const open = deferred();
    const api = install({ send: () => open.promise });
    mount();
    await userEvent.type(box(), 'Question{Enter}');
    const list = await screen.findByTestId('ListMeetingChat');
    expect(within(list).getByText('Question')).toBeTruthy();
    expect(within(list).getByText('Thinking…')).toBeTruthy();
    expect(box().value).toBe('');
    expect(screen.queryByTestId('BtnMeetingChatCopy')).toBeNull();
    act(() => {
      api.emit('chat.chunk', { requestId: api.sends[0]?.requestId, text: 'Partial **bo' });
    });
    expect(within(list).queryByText('Thinking…')).toBeNull();
    expect(list.textContent).toContain('Partial');
    expect(screen.queryByTestId('BtnMeetingChatCopy')).toBeNull();
    await act(async () => {
      open.settle({
        status: 'answered',
        user: msg('u', 'user', 'Question'),
        assistant: msg('a', 'assistant', 'Done'),
        notice: null,
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId('BtnMeetingChatCopy')).toBeTruthy();
  });

  it('on failure removes both rows, restores the draft and shows a closable notice', async () => {
    install({
      send: () =>
        Promise.resolve<ChatSendOutcomeDto>({
          status: 'failed',
          kind: 'send-failed',
          message: 'Could not answer. boom',
          originalDraft: 'Question',
        }),
    });
    mount();
    await userEvent.type(box(), 'Question{Enter}');
    const notice = await screen.findByTestId('InfoMeetingChatError');
    expect(notice.textContent).toContain('Could not answer');
    expect(notice.textContent).toContain('boom');
    // Item 45: severity error, announced as an alert.
    const alert = within(notice).getByRole('alert');
    expect(alert.getAttribute('data-tone')).toBe('error');
    expect(screen.queryByTestId('ListMeetingChat')).toBeNull();
    expect(box().value).toBe('Question');
    await userEvent.click(within(notice).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('InfoMeetingChatError')).toBeNull();
  });

  it('does not overwrite text typed while the answer ran', async () => {
    const open = deferred();
    install({ send: () => open.promise });
    mount();
    await userEvent.type(box(), 'Question{Enter}');
    await userEvent.type(box(), 'newer');
    await act(async () => {
      open.settle({ status: 'cancelled', originalDraft: 'Question' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('ListMeetingChat')).toBeNull();
    });
    expect(box().value).toBe('newer');
  });

  it('clears the error on the next send', async () => {
    let n = 0;
    install({
      send: (_, input) => {
        n += 1;
        return Promise.resolve<ChatSendOutcomeDto>(
          n === 1
            ? { status: 'failed', kind: 'send-failed', message: 'nope', originalDraft: input.draft }
            : {
                status: 'answered',
                user: msg('u', 'user', input.draft),
                assistant: msg('a', 'assistant', 'ok'),
                notice: null,
              },
        );
      },
    });
    mount();
    await userEvent.type(box(), 'q{Enter}');
    await screen.findByTestId('InfoMeetingChatError');
    await userEvent.click(sendButton());
    await waitFor(() => {
      expect(screen.queryByTestId('InfoMeetingChatError')).toBeNull();
    });
  });
});

const chipNames = async (): Promise<string[]> =>
  within(await screen.findByTestId('ListMeetingChatStarters'))
    .getAllByRole('button')
    .map((b) => b.textContent);

const MEETING_CHIPS = [
  "What's been discussed",
  'Action items',
  'Follow-up email',
  'What should I do next',
];
const CONTENT_CHIPS = [
  'Key ideas',
  'Explain the hard parts',
  'Notable quotes',
  "What's been discussed",
];
const ITEM = { text: 'Send the deck', isDone: false };

describe('starter chips (items 39 to 41)', () => {
  it('a meeting with action items shows the four meeting recipes', async () => {
    install({ actionItems: () => [ITEM] });
    mount(MEETING);
    expect(await chipNames()).toEqual(MEETING_CHIPS);
  });

  it('a meeting without action items (a talk, a class) shows the content recipes', async () => {
    install({ actionItems: () => [] });
    mount(MEETING);
    expect(await chipNames()).toEqual(CONTENT_CHIPS);
  });

  it('a meeting the library cannot find falls back to the content recipes', async () => {
    install({});
    mount(MEETING);
    expect(await chipNames()).toEqual(CONTENT_CHIPS);
  });

  it('follows the library: action items arriving switch the chips to the meeting recipes', async () => {
    let items: { text: string; isDone: boolean }[] = [];
    const api = install({ actionItems: () => items });
    mount(MEETING);
    expect(await chipNames()).toEqual(CONTENT_CHIPS);
    items = [ITEM];
    act(() => {
      api.emit('library.changed', {});
    });
    await waitFor(async () => {
      expect(await chipNames()).toEqual(MEETING_CHIPS);
    });
  });

  it('the recipes menu lists every single-meeting recipe, content first without action items', async () => {
    install({ actionItems: () => [] });
    mount(MEETING);
    await chipNames();
    await userEvent.click(screen.getByTestId('BtnMeetingChatRecipes'));
    const names = within(screen.getByTestId('ListMeetingChatRecipes'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toHaveLength(9);
    expect(names[0]?.startsWith('Key ideas')).toBe(true);
    expect(names[5]?.startsWith('Action items')).toBe(true);
  });

  it('the recipes menu puts the meeting recipes first when there are action items', async () => {
    install({ actionItems: () => [ITEM] });
    mount(MEETING);
    await chipNames();
    await userEvent.click(screen.getByTestId('BtnMeetingChatRecipes'));
    const names = within(screen.getByTestId('ListMeetingChatRecipes'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toHaveLength(9);
    expect(names[1]?.startsWith('Action items')).toBe(true);
    expect(names[5]?.startsWith('Key ideas')).toBe(true);
  });

  it('uses the multi-meeting recipes for a folder or all meetings', async () => {
    const api = install({});
    mount(ALL);
    expect(await chipNames()).toEqual([
      'Top feature requests',
      'Recurring themes',
      'Weekly update',
    ]);
    expect(api.calls).not.toContain('library.getMeeting');
  });

  it('in Spanish a chip sends the Spanish prompt, not the English one', async () => {
    const api = install({ actionItems: () => [ITEM] });
    mount(MEETING, 'es');
    await userEvent.click(await screen.findByRole('button', { name: 'Qué se ha hablado' }));
    await waitFor(() => {
      expect(api.sends[0]?.draft).toBe('Haz un breve resumen de lo que se ha hablado hasta ahora.');
    });
  });

  it('a click sends the prompt at once and hides the chips', async () => {
    const api = install({ actionItems: () => [ITEM] });
    mount(MEETING);
    await userEvent.click(await screen.findByRole('button', { name: "What's been discussed" }));
    await waitFor(() => {
      expect(api.sends[0]?.draft).toBe('Give a short recap of what has been discussed so far.');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('ListMeetingChatStarters')).toBeNull();
    });
  });

  it('are hidden while sending and when messages exist', async () => {
    install({
      state: stateOf({ messages: [msg('u', 'user', 'old'), msg('a', 'assistant', 'older')] }),
    });
    mount(MEETING);
    await screen.findByTestId('ListMeetingChat');
    expect(screen.queryByTestId('ListMeetingChatStarters')).toBeNull();
  });
});

describe('live chips (T2)', () => {
  it('Live scope shows the four live chips, never the meeting ones', async () => {
    install({});
    mount(LIVE);
    expect(await chipNames()).toEqual([
      'Catch me up (last 2 min)',
      'Summary so far',
      'Suggest questions',
      'Decisions and tasks',
    ]);
  });

  it('a meeting scope never shows the live chips', async () => {
    install({ actionItems: () => [ITEM] });
    mount(MEETING);
    expect(await chipNames()).not.toContain('Summary so far');
  });

  it('in Spanish the live chip sends the Spanish prompt with (mm:ss) times', async () => {
    const api = install({});
    mount(LIVE, 'es');
    await userEvent.click(await screen.findByRole('button', { name: 'Resumen hasta ahora' }));
    await waitFor(() => {
      expect(api.sends[0]?.draft).toMatch(/^Resume la grabación hasta ahora/);
    });
    expect(api.sends[0]?.draft).toContain('(mm:ss)');
  });
});

describe('copy and stop (items 42, 43, B19)', () => {
  const seeded = stateOf({
    messages: [msg('u', 'user', 'old'), msg('a', 'assistant', 'older answer')],
    hasMessages: true,
  });

  it('copies a completed answer through the main process', async () => {
    const api = install({ state: seeded });
    mount();
    await userEvent.click(await screen.findByTestId('BtnMeetingChatCopy'));
    expect(api.calls).toContain('chat.copyText');
    expect(screen.queryByTestId('InfoMeetingChatError')).toBeNull();
  });

  it('shows Could not copy when the clipboard fails', async () => {
    install({ state: seeded, copy: () => ({ status: 'failed', detail: 'denied' }) });
    mount();
    await userEvent.click(await screen.findByTestId('BtnMeetingChatCopy'));
    const notice = await screen.findByTestId('InfoMeetingChatError');
    expect(notice.textContent).toContain('Could not copy. denied');
  });

  it('shows Stop while sending and cancels the answer', async () => {
    const open = deferred();
    const api = install({ send: () => open.promise });
    mount();
    expect(screen.queryByTestId('BtnMeetingChatStop')).toBeNull();
    await userEvent.type(box(), 'q{Enter}');
    await userEvent.click(await screen.findByTestId('BtnMeetingChatStop'));
    expect(api.calls).toContain('chat.cancel');
    await act(async () => {
      open.settle({ status: 'cancelled', originalDraft: 'q' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('BtnMeetingChatStop')).toBeNull();
    });
    expect(box().value).toBe('q');
    expect(screen.queryByTestId('InfoMeetingChatError')).toBeNull();
  });
});

describe('scope mismatch and accessible text (items 36, 126)', () => {
  it('shows the mismatch text from the state, also while sending', async () => {
    const api = install({
      state: stateOf({
        messages: [msg('u', 'user', 'old')],
        hasMessages: true,
        showScopeMismatch: true,
      }),
    });
    mount();
    expect((await screen.findByTestId('TxtMeetingChatScopeMismatch')).textContent).toBe(
      'This chat is from another scope. Sending starts a new chat.',
    );
    act(() => {
      api.emit('chat.stateChanged', {
        state: stateOf({ messages: [], showScopeMismatch: false }),
      });
    });
    expect(screen.queryByTestId('TxtMeetingChatScopeMismatch')).toBeNull();
  });

  it('gives each message the text Role: text', async () => {
    install({
      state: stateOf({
        messages: [msg('u', 'user', 'Hello'), msg('a', 'assistant', 'Hi there')],
        hasMessages: true,
      }),
    });
    mount();
    expect(await screen.findByRole('listitem', { name: 'You: Hello' })).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Assistant: Hi there' })).toBeTruthy();
  });
});

describe('provider gate (item 38)', () => {
  const needsSetup: ChatSendOutcomeDto = {
    status: 'setup-required',
    kind: 'Local',
    originalDraft: 'Question',
  };

  it('runs the gate and sends once more when setup completes', async () => {
    const api = install({
      send: (n, input) =>
        Promise.resolve<ChatSendOutcomeDto>(
          n === 1
            ? needsSetup
            : {
                status: 'answered',
                user: msg('u', 'user', input.draft),
                assistant: msg('a', 'assistant', 'ready now'),
                notice: null,
              },
        ),
    });
    mount();
    await userEvent.type(box(), 'Question{Enter}');
    await userEvent.click(await screen.findByText('gate done'));
    await waitFor(() => {
      expect(screen.getByText('ready now')).toBeTruthy();
    });
    expect(api.sends).toHaveLength(2);
    expect(api.sends[1]?.requestId).not.toBe(api.sends[0]?.requestId);
  });

  it('a cancelled gate rolls back, restores the draft and says setup was cancelled', async () => {
    const api = install({ send: () => Promise.resolve(needsSetup) });
    mount();
    await userEvent.type(box(), 'Question{Enter}');
    await userEvent.click(await screen.findByText('gate cancel'));
    const notice = await screen.findByTestId('InfoMeetingChatError');
    expect(notice.textContent).toBe('Setup cancelled.');
    expect(box().value).toBe('Question');
    expect(api.sends).toHaveLength(1);
    expect(screen.queryByTestId('ListMeetingChat')).toBeNull();
  });
});

describe('language (B8)', () => {
  it('relabels the chips and the placeholder in Spanish', async () => {
    install({ actionItems: () => [] });
    mount(MEETING, 'es');
    expect(box().placeholder).toBe('Pregunta sobre tus reuniones');
    expect(await chipNames()).toEqual([
      'Ideas principales',
      'Explícame lo más difícil',
      'Citas destacadas',
      'Qué se ha hablado',
    ]);
  });
});

describe('audit fixes', () => {
  it('the Send tooltip names both chords, Enter and Ctrl+Enter (item 30, bug 23)', async () => {
    install({});
    mount();
    await userEvent.type(box(), 'x');
    await userEvent.hover(sendButton());
    const tooltip = (await screen.findByText('Ctrl')).closest('span.gap-2');
    expect(tooltip?.textContent).toBe('SendEnter/Ctrl+Enter');
    expect([...(tooltip?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent)).toEqual([
      'Enter',
      'Ctrl',
      'Enter',
    ]);
  });

  it('a rejected chat.send rolls back, shows a mapped sentence and unlocks sending (items 39, 43)', async () => {
    let n = 0;
    const api = install({
      send: () => {
        n += 1;
        return n === 1
          ? Promise.reject(new Error('boom at a secret path'))
          : Promise.resolve<ChatSendOutcomeDto>({
              status: 'answered',
              user: msg('u', 'user', 'again'),
              assistant: msg('a', 'assistant', 'second answer'),
              notice: null,
            });
      },
    });
    mount();
    await userEvent.type(box(), 'first{Enter}');
    const notice = await screen.findByTestId('InfoMeetingChatError');
    expect(box().value).toBe('first');
    expect(notice.textContent.startsWith('Could not answer')).toBe(true);
    // The title is not repeated by the body.
    expect(notice.textContent.match(/Could not answer/g)).toHaveLength(1);
    await userEvent.clear(box());
    await userEvent.type(box(), 'again{Enter}');
    await waitFor(() => {
      expect(screen.getByText('second answer')).toBeTruthy();
    });
    expect(api.sends).toHaveLength(2);
  });

  it('opens the CLI setup dialog for Claude Code and Codex (item 37)', async () => {
    for (const kind of ['ClaudeCode', 'Codex'] as const) {
      install({
        send: () => Promise.resolve({ status: 'setup-required', kind, originalDraft: 'q' }),
      });
      const view = mount();
      await userEvent.type(box(), 'q{Enter}');
      const gate = await screen.findByTestId('GateStub');
      expect(JSON.parse(gate.getAttribute('data-open') ?? '{}')).toEqual({
        surface: 'cli',
        kind,
      });
      view.unmount();
      cleanup();
    }
  });

  it('Stop before chat.send reaches main drops the answer (B19)', async () => {
    let release!: () => void;
    const gap = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = install({ beforeSend: () => gap });
    mount();
    await userEvent.type(box(), 'q{Enter}');
    await userEvent.click(await screen.findByTestId('BtnMeetingChatStop'));
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('BtnMeetingChatStop')).toBeNull();
    });
    expect(api.sends).toHaveLength(0);
    expect(box().value).toBe('q');
  });
});

describe('apply to summary (T4)', () => {
  const seeded = stateOf({
    messages: [
      msg('u', 'user', 'Make the summary more detailed'),
      msg(
        'a',
        'assistant',
        'Longer summary at [05:12](https://meetinglive.local/meeting/m1?t=312).',
      ),
    ],
    hasMessages: true,
  });
  const applyButton = () => screen.queryByTestId('BtnMeetingChatApplySummary');
  const replaces = (api: Api) => api.inputs.filter((c) => c.name === 'summaries.replaceSummary');

  it('shows on completed answers in a meeting scope only, named for screen readers', async () => {
    install({ state: seeded });
    const view = mount(MEETING);
    const button = await screen.findByTestId('BtnMeetingChatApplySummary');
    expect(button.getAttribute('aria-label')).toBe('Apply to summary');
    expect(screen.getAllByTestId('BtnMeetingChatApplySummary')).toHaveLength(1);
    view.unmount();
    install({ state: seeded });
    mount(ALL);
    await screen.findByTestId('BtnMeetingChatCopy');
    expect(applyButton()).toBeNull();
  });

  it('asks first; Cancel writes nothing', async () => {
    const api = install({ state: seeded });
    mount(MEETING);
    await userEvent.click(await screen.findByTestId('BtnMeetingChatApplySummary'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Replace the summary?')).toBeTruthy();
    expect(within(dialog).getByTestId('DialogPrimary').textContent).toBe('Replace');
    await userEvent.click(within(dialog).getByTestId('DialogClose'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(replaces(api)).toHaveLength(0);
    expect(screen.queryByTestId('InfoMeetingChatSummary')).toBeNull();
  });

  it('Replace sends the answer as is (citations kept) and Undo restores the previous content', async () => {
    const api = install({ state: seeded });
    mount(MEETING);
    await userEvent.click(await screen.findByTestId('BtnMeetingChatApplySummary'));
    await userEvent.click(await screen.findByTestId('DialogPrimary'));
    const notice = await screen.findByTestId('InfoMeetingChatSummary');
    expect(notice.textContent).toContain('Summary updated');
    expect(replaces(api)[0]?.input).toEqual({
      meetingId: 'm1',
      source: {
        kind: 'answer',
        text: 'Longer summary at [05:12](https://meetinglive.local/meeting/m1?t=312).',
      },
    });
    await userEvent.click(within(notice).getByTestId('BtnMeetingChatSummaryUndo'));
    await waitFor(() => {
      expect(screen.getByTestId('InfoMeetingChatSummary').textContent).toContain(
        'Summary restored',
      );
    });
    expect(replaces(api)[1]?.input).toEqual({
      meetingId: 'm1',
      source: { kind: 'restore', summary: 'Old.', actionItems: [{ text: 'Keep', isDone: true }] },
    });
    expect(screen.queryByTestId('BtnMeetingChatSummaryUndo')).toBeNull();
  });

  it('a failed Undo keeps the previous content, shows the error and can try again', async () => {
    let calls = 0;
    const api = install({
      state: seeded,
      replace: () => {
        calls += 1;
        if (calls === 2) return { status: 'failed', detail: 'The file is locked.' };
        if (calls === 3) throw new Error('Main went away.');
        return {
          status: 'saved',
          previous: { summary: 'Old.', actionItems: [{ text: 'Keep', isDone: true }] },
        };
      },
    });
    mount(MEETING);
    await userEvent.click(await screen.findByTestId('BtnMeetingChatApplySummary'));
    await userEvent.click(await screen.findByTestId('DialogPrimary'));
    const applied = await screen.findByTestId('InfoMeetingChatSummary');
    await userEvent.click(within(applied).getByTestId('BtnMeetingChatSummaryUndo'));
    const failed = await screen.findByTestId('InfoMeetingChatSummaryError');
    expect(failed.textContent).toContain('The file is locked.');
    await userEvent.click(within(failed).getByTestId('BtnMeetingChatSummaryUndo'));
    await waitFor(() => {
      expect(screen.getByTestId('InfoMeetingChatSummaryError').textContent).toContain(
        'Main went away.',
      );
    });
    await userEvent.click(
      within(screen.getByTestId('InfoMeetingChatSummaryError')).getByTestId(
        'BtnMeetingChatSummaryUndo',
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('InfoMeetingChatSummary').textContent).toContain(
        'Summary restored',
      );
    });
    const restore = {
      meetingId: 'm1',
      source: { kind: 'restore', summary: 'Old.', actionItems: [{ text: 'Keep', isDone: true }] },
    };
    expect(
      replaces(api)
        .slice(1)
        .map((c) => c.input),
    ).toEqual([restore, restore, restore]);
  });

  it('a busy meeting answers a plain sentence and offers no Undo', async () => {
    install({ state: seeded, replace: () => ({ status: 'busy' }) });
    mount(MEETING);
    await userEvent.click(await screen.findByTestId('BtnMeetingChatApplySummary'));
    await userEvent.click(await screen.findByTestId('DialogPrimary'));
    const notice = await screen.findByTestId('InfoMeetingChatSummaryError');
    expect(notice.textContent).toContain('A summary is being generated');
    expect(screen.queryByTestId('BtnMeetingChatSummaryUndo')).toBeNull();
  });

  it('speaks Spanish', async () => {
    install({ state: seeded });
    mount(MEETING, 'es');
    const button = await screen.findByTestId('BtnMeetingChatApplySummary');
    expect(button.getAttribute('aria-label')).toBe('Aplicar al resumen');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('¿Reemplazar el resumen?')).toBeTruthy();
    expect(within(dialog).getByTestId('DialogClose').textContent).toBe('Cancelar');
    await userEvent.click(within(dialog).getByTestId('DialogPrimary'));
    expect((await screen.findByTestId('InfoMeetingChatSummary')).textContent).toContain(
      'Resumen actualizado',
    );
  });
});
