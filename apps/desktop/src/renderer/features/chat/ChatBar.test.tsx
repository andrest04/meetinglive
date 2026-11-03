// @vitest-environment jsdom
import type { WorkspaceStateDto } from '@vozella/contracts';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { ChatBar } from './ChatBar';

type Listener = (payload: unknown) => void;

const MEETING = '11111111-1111-4111-8111-111111111111';
const FOLDER = '22222222-2222-4222-8222-222222222222';

function install(initial: Partial<WorkspaceStateDto> = {}) {
  let state: WorkspaceStateDto = {
    selectedMeetingId: null,
    lastProcessedMeetingId: null,
    sessionTab: 'Transcript',
    currentShellTag: 'Recording',
    selectedFolderId: null,
    liveTranscript: '',
    isCaptureActive: false,
    ...initial,
  };
  const listeners = new Map<string, Set<Listener>>();
  const titles: Record<string, { title: string; delay?: Promise<void> }> = {
    [MEETING]: { title: 'Weekly planning' },
  };
  const calls: { name: string; input: unknown }[] = [];
  const invoke = vi.fn(async (name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    switch (name) {
      case 'workspace.getState':
        return state;
      case 'library.getMeeting': {
        const entry = titles[input.id as string];
        if (entry?.delay) await entry.delay;
        return { record: entry ? { title: entry.title } : null };
      }
      case 'library.load':
        return { ok: true, folders: [{ id: FOLDER, name: 'Calculo' }], meetings: [], skipped: [] };
      case 'chat.setScope':
        return { canStartNewChat: true };
      case 'chat.newChat':
        return { started: true };
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
    calls,
    titles,
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

const mount = (locale: 'en' | 'es' = 'en') =>
  render(
    <Providers locale={locale}>
      <ChatBar>
        <p>body slot</p>
      </ChatBar>
    </Providers>,
  );

const chip = () => screen.getByTestId('LblMeetingChatScope');

/** The body stays mounted while collapsed so a running send survives; `hidden` hides it. */
const bodyHidden = (): boolean => screen.getByText('body slot').closest('[hidden]') !== null;

describe('ChatBar scope chip (items 6 to 11)', () => {
  it('shows All meetings on an idle Record page', async () => {
    install();
    mount();
    await waitFor(() => {
      expect(chip().textContent).toBe('All meetings');
    });
    expect(screen.getByTestId('BarMeetingChat')).toBeTruthy();
    expect(screen.getByTestId('BtnMeetingChatNew')).toBeTruthy();
    expect(screen.queryByTestId('BtnMeetingChatHistory')).toBeNull();
  });

  it('shows Live while capture is active, in Spanish too', async () => {
    install({ isCaptureActive: true });
    mount('es');
    await waitFor(() => {
      expect(chip().textContent).toBe('En vivo');
    });
  });

  it('shows the meeting title, and the plain label when the meeting is gone', async () => {
    const api = install({ currentShellTag: 'Session', selectedMeetingId: MEETING });
    mount();
    await waitFor(() => {
      expect(chip().textContent).toBe('Meeting: Weekly planning');
    });
    Reflect.deleteProperty(api.titles, MEETING);
    await api.change({ selectedMeetingId: '33333333-3333-4333-8333-333333333333' });
    await waitFor(() => {
      expect(chip().textContent).toBe('Meeting');
    });
  });

  it('shows the folder name on the library, and Carpeta without a name in Spanish', async () => {
    install({ currentShellTag: 'History', selectedFolderId: FOLDER });
    mount();
    await waitFor(() => {
      expect(chip().textContent).toBe('Folder: Calculo');
    });
    cleanup();
    install({ currentShellTag: 'History', selectedFolderId: 'missing' });
    mount('es');
    await waitFor(() => {
      expect(chip().textContent).toBe('Carpeta');
    });
  });

  it('uses four different icons for the four scopes', async () => {
    const markup = new Set<string>();
    for (const state of [
      { isCaptureActive: true },
      { currentShellTag: 'Session' as const, selectedMeetingId: MEETING },
      { currentShellTag: 'History' as const, selectedFolderId: FOLDER },
      {},
    ]) {
      install(state);
      const { container, unmount } = mount();
      await waitFor(() => {
        expect(chip().textContent).not.toBe('');
      });
      markup.add(container.querySelector('button svg')?.getAttribute('class') ?? '');
      unmount();
    }
    expect(markup.size).toBe(4);
  });

  it('discards a name lookup that finishes after the scope moved on (item 18)', async () => {
    let release: () => void = () => undefined;
    const api = install({ currentShellTag: 'Session', selectedMeetingId: MEETING });
    api.titles[MEETING] = {
      title: 'Slow meeting',
      delay: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    mount();
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'library.getMeeting')).toBe(true);
    });
    await api.change({ currentShellTag: 'Recording', selectedMeetingId: null });
    await waitFor(() => {
      expect(chip().textContent).toBe('All meetings');
    });
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(chip().textContent).toBe('All meetings');
  });
});

describe('scope delivery (items 18 to 20)', () => {
  const setScopes = (api: ReturnType<typeof install>) =>
    api.calls.filter((c) => c.name === 'chat.setScope').map((c) => c.input);

  it('delivers the final scope to main even when a refresh is superseded mid lookup', async () => {
    let release: () => void = () => undefined;
    const api = install({ currentShellTag: 'Session', selectedMeetingId: MEETING });
    api.titles[MEETING] = {
      title: 'Slow',
      delay: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    mount();
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'library.getMeeting')).toBe(true);
    });
    await api.change({
      currentShellTag: 'Session',
      selectedMeetingId: null,
      selectedFolderId: FOLDER,
    });
    await api.change({ currentShellTag: 'Recording', selectedFolderId: null });
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chip().textContent).toBe('All meetings');
    });
    const sent = setScopes(api) as { scope: { kind: string } }[];
    expect(sent.at(-1)?.scope.kind).toBe('AllMeetings');
  });

  it('does not refresh when only the live transcript changes (item 20)', async () => {
    const api = install({ isCaptureActive: true });
    mount();
    await waitFor(() => {
      expect(setScopes(api).length).toBeGreaterThan(0);
    });
    const before = api.calls.length;
    await api.change({ liveTranscript: 'hello there' });
    await api.change({ liveTranscript: 'hello there again' });
    expect(api.calls.length).toBe(before);
  });
});

describe('ChatBar visibility and expansion (items 1 to 5)', () => {
  it('is hidden entirely on Settings', async () => {
    const api = install({ currentShellTag: 'Settings' });
    mount();
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'chat.setScope')).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('BarMeetingChat').hidden).toBe(true);
  });

  it('starts collapsed and toggles from the header with the keyboard', async () => {
    install();
    mount();
    const toggle = await screen.findByRole('button', { name: /All meetings/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(bodyHidden()).toBe(true);
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(bodyHidden()).toBe(false);
    await userEvent.keyboard(' ');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses when the scope changes but not when it stays the same', async () => {
    const api = install({ currentShellTag: 'Session', selectedMeetingId: MEETING });
    mount();
    const toggle = await screen.findByRole('button', { name: /Meeting: Weekly planning/ });
    await userEvent.click(toggle);
    expect(bodyHidden()).toBe(false);
    await api.change({ sessionTab: 'Summary' });
    expect(bodyHidden()).toBe(false);
    await api.change({ currentShellTag: 'Recording', selectedMeetingId: null });
    await waitFor(() => {
      expect(bodyHidden()).toBe(true);
    });
  });

  it('New chat starts a chat and expands the bar', async () => {
    const api = install();
    mount();
    const button = await screen.findByTestId('BtnMeetingChatNew');
    await waitFor(() => {
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
    await userEvent.click(button);
    await waitFor(() => {
      expect(bodyHidden()).toBe(false);
    });
    expect(api.calls.some((c) => c.name === 'chat.newChat')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('New chat');
  });

  it('names the bar for assistive technology', async () => {
    install();
    mount();
    expect(await screen.findByRole('region', { name: 'Meeting chat' })).toBeTruthy();
  });
});
