// @vitest-environment jsdom
import type { ChatScopeDto, ChatSendOutcomeDto } from '@vozella/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import type { ProviderGate } from '../summaries/use-provider-gate';
import { useChat } from './use-chat';

const SCOPE: ChatScopeDto = {
  kind: 'Meeting',
  isVisible: true,
  folderId: null,
  meetingId: 'm1',
};

const msg = (id: string, role: 'user' | 'assistant', text: string) => ({
  id,
  role,
  text,
  createdAt: '2026-09-01T09:00:00Z',
});

/**
 * Main as the setup gate leaves it: finishing the gate saves the gated engine as the default
 * (`chooseCli` / `chooseLocalModel`). The settings live here so the test can read them back.
 */
function install(defaultProvider: string | null) {
  const settings = { selectedSummaryProvider: defaultProvider };
  const sends: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const invoke = vi.fn(async (name: string, input: Record<string, unknown>) => {
    await Promise.resolve();
    switch (name) {
      case 'chat.state':
        return {
          messages: [],
          isSending: false,
          showScopeMismatch: false,
          hasMessages: false,
          canStartNewChat: true,
          attachments: [],
        };
      case 'workspace.getState':
        return { liveTranscript: '' };
      case 'settings.get':
        return { ...settings };
      case 'settings.update': {
        const patch = input.patch as { selectedSummaryProvider?: string | null };
        updates.push(patch);
        Object.assign(settings, patch);
        return { ...settings };
      }
      case 'chat.send': {
        sends.push(input);
        if (sends.length === 1) {
          return {
            status: 'setup-required',
            kind: 'Codex',
            originalDraft: input.draft as string,
          } satisfies ChatSendOutcomeDto;
        }
        return {
          status: 'answered',
          user: msg('u', 'user', input.draft as string),
          assistant: msg('a', 'assistant', 'ok'),
          notice: null,
        } satisfies ChatSendOutcomeDto;
      }
      default:
        throw new Error(`unhandled ${name}`);
    }
  });
  Object.defineProperty(window, 'vozella', {
    value: { invoke, on: () => () => undefined },
    configurable: true,
    writable: true,
  });
  return { settings, sends, updates };
}

/** A gate that completes the way the CLI dialog does: main saves the engine as the default. */
function completingGate(settings: { selectedSummaryProvider: string | null }): ProviderGate {
  return {
    runSetup: (request) => {
      settings.selectedSummaryProvider = request.kind;
      return Promise.resolve('completed');
    },
    open: null,
    unavailable: false,
    finish: () => undefined,
    dismissUnavailable: () => undefined,
    openSettings: () => undefined,
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <Providers>{children}</Providers>;

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('setup gate for a saved prompt engine (item 8)', () => {
  it('finishing the gate keeps the default engine in Settings', async () => {
    const api = install('Local');
    const { result } = renderHook(() => useChat(SCOPE, completingGate(api.settings)), {
      wrapper,
    });
    await act(async () => {
      expect(await result.current.send('Risks?', { engine: 'codex' })).toBe('answered');
    });
    expect(api.sends).toHaveLength(2);
    expect(api.sends[1]).toMatchObject({ engine: 'codex' });
    expect(api.settings.selectedSummaryProvider).toBe('Local');
  });

  it('a default that was never chosen stays unchosen', async () => {
    const api = install(null);
    const { result } = renderHook(() => useChat(SCOPE, completingGate(api.settings)), {
      wrapper,
    });
    await act(async () => {
      await result.current.send('Risks?', { engine: 'codex' });
    });
    expect(api.settings.selectedSummaryProvider).toBeNull();
  });

  it('a send without a prompt engine lets the gate set the default, as before', async () => {
    const api = install('Local');
    const { result } = renderHook(() => useChat(SCOPE, completingGate(api.settings)), {
      wrapper,
    });
    await act(async () => {
      await result.current.send('Risks?');
    });
    expect(api.settings.selectedSummaryProvider).toBe('Codex');
    expect(api.updates).toEqual([]);
  });
});
