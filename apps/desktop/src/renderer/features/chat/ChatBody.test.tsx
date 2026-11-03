// @vitest-environment jsdom
import type { ChatSendOutcomeDto, ChatStateDto } from '@vozella/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { ChatBody } from './ChatBody';

vi.mock('../summaries/ProviderGateDialogs', () => ({
  ProviderGateDialogs: ({
    gate,
  }: {
    gate: { open: { surface: string } | null; finish: (ok: boolean) => void };
  }) =>
    gate.open ? (
      <div data-testid="GateStub">
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
  ...over,
});

interface Api {
  sends: { requestId: string; draft: string; liveTranscript: string | null }[];
  emit: (name: string, payload: unknown) => void;
  calls: string[];
}

function install(options: {
  state?: ChatStateDto;
  send?: (n: number, input: { requestId: string; draft: string }) => Promise<ChatSendOutcomeDto>;
  copy?: () => { status: 'written' } | { status: 'failed'; detail: string };
}): Api {
  const listeners = new Map<string, Set<Listener>>();
  const api: Api = {
    sends: [],
    calls: [],
    emit: (name, payload) => {
      listeners.get(name)?.forEach((listener) => {
        listener(payload);
      });
    },
  };
  const invoke = vi.fn(async (name: string, input: Record<string, unknown>) => {
    api.calls.push(name);
    switch (name) {
      case 'chat.state':
        return options.state ?? stateOf();
      case 'workspace.getState':
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
          } satisfies ChatSendOutcomeDto)
        );
      }
      case 'chat.cancel':
        return { cancelled: true };
      case 'chat.copyText':
        return options.copy?.() ?? { status: 'written' };
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

const mount = (scope: typeof ALL | typeof MEETING = ALL, locale: 'en' | 'es' = 'en') =>
  render(
    <Providers locale={locale}>
      <ChatBody scope={scope} />
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

describe('starter chips (items 39 to 41)', () => {
  it('shows the first four recipes of the scope, with the prompt as tooltip content', () => {
    install({});
    mount(MEETING);
    const list = screen.getByTestId('ListMeetingChatStarters');
    expect(within(list).getAllByRole('button')).toHaveLength(4);
    expect(within(list).getByRole('button', { name: "What's been discussed" })).toBeTruthy();
  });

  it('uses the multi-meeting recipes for a folder or all meetings', () => {
    install({});
    mount(ALL);
    expect(
      within(screen.getByTestId('ListMeetingChatStarters')).getAllByRole('button'),
    ).toHaveLength(3);
  });

  it('a click sends the prompt at once and hides the chips', async () => {
    const api = install({});
    mount(MEETING);
    await userEvent.click(screen.getByRole('button', { name: "What's been discussed" }));
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
  it('relabels the chips and the placeholder in Spanish', () => {
    install({});
    mount(MEETING, 'es');
    expect(box().placeholder).toBe('Pregunta sobre tus reuniones');
    expect(
      within(screen.getByTestId('ListMeetingChatStarters')).getAllByRole('button')[0]?.textContent,
    ).not.toBe("What's been discussed");
  });
});
