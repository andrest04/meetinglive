// @vitest-environment jsdom
import type { ChatSendOutcomeDto, WorkspaceStateDto } from '@vozella/contracts';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { ChatBar } from './ChatBar';
import { ChatBody } from './ChatBody';

vi.mock('../summaries/ProviderGateDialogs', () => ({ ProviderGateDialogs: () => null }));

type Listener = (payload: unknown) => void;

const MEETING = '11111111-1111-4111-8111-111111111111';

function install(send: () => Promise<ChatSendOutcomeDto>) {
  let state: WorkspaceStateDto = {
    selectedMeetingId: null,
    lastProcessedMeetingId: null,
    sessionTab: 'Transcript',
    currentShellTag: 'Recording',
    selectedFolderId: null,
    liveTranscript: '',
    isCaptureActive: false,
  };
  const listeners = new Map<string, Set<Listener>>();
  const invoke = vi.fn(async (name: string) => {
    switch (name) {
      case 'workspace.getState':
        return state;
      case 'library.getMeeting':
        return { record: { title: 'Weekly planning' } };
      case 'library.load':
        return { ok: true, folders: [], meetings: [], skipped: [] };
      case 'chat.setScope':
        return { canStartNewChat: true };
      case 'chat.state':
        return {
          messages: [],
          isSending: false,
          showScopeMismatch: false,
          hasMessages: false,
          canStartNewChat: true,
        };
      case 'chat.newChat':
        return { started: true };
      case 'chat.send':
        return send();
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
  return {
    change: async (next: Partial<WorkspaceStateDto>) => {
      state = { ...state, ...next };
      await act(async () => {
        listeners.get('workspace.changed')?.forEach((listener) => {
          listener({ state });
        });
        await Promise.resolve();
      });
    },
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const mount = () =>
  render(
    <Providers locale="en">
      <ChatBar>{(scope) => <ChatBody scope={scope} />}</ChatBar>
    </Providers>,
  );

function deferred() {
  let settle!: (outcome: ChatSendOutcomeDto) => void;
  const promise = new Promise<ChatSendOutcomeDto>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

async function startSend(text: string) {
  const header = await screen.findByRole('button', { name: /All meetings/ });
  await userEvent.click(header);
  await userEvent.type(await screen.findByTestId('TxtMeetingChat'), `${text}{Enter}`);
  await within(await screen.findByTestId('ListMeetingChat')).findByText('Thinking…');
  return header;
}

describe('a send survives the bar collapsing or the scope changing (items 33, 42, 43, 45)', () => {
  it('keeps the pending rows while collapsed and shows the failure and draft after reopening', async () => {
    const open = deferred();
    install(() => open.promise);
    mount();
    const header = await startSend('Question');
    await userEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    await act(async () => {
      open.settle({
        status: 'failed',
        kind: 'send-failed',
        message: 'No answer today',
        originalDraft: 'Question',
      });
      await Promise.resolve();
    });
    await userEvent.click(header);
    expect(await screen.findByText('No answer today')).toBeTruthy();
    expect(screen.getByTestId<HTMLTextAreaElement>('TxtMeetingChat').value).toBe('Question');
    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('keeps the pending turn when the scope change collapses the bar', async () => {
    const open = deferred();
    const api = install(() => open.promise);
    mount();
    await startSend('Question');
    await api.change({ currentShellTag: 'Session', selectedMeetingId: MEETING });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Meeting: Weekly planning/ })).toBeTruthy();
    });
    expect(
      screen
        .getByRole('button', { name: /Meeting: Weekly planning/ })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.getByText('Thinking…')).toBeTruthy();
    await act(async () => {
      open.settle({ status: 'cancelled', originalDraft: 'Question' });
      await Promise.resolve();
    });
    expect(screen.queryByText('Thinking…')).toBeNull();
  });

  it('keeps New chat disabled from the first click of send, before main knows', async () => {
    const open = deferred();
    install(() => open.promise);
    mount();
    await startSend('Question');
    expect(screen.getByTestId<HTMLButtonElement>('BtnMeetingChatNew').disabled).toBe(true);
    await act(async () => {
      open.settle({ status: 'cancelled', originalDraft: 'Question' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('BtnMeetingChatNew').disabled).toBe(false);
    });
  });
});
