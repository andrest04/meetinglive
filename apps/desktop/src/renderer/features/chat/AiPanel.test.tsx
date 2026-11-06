// @vitest-environment jsdom
import type { WorkspaceStateDto } from '@vozella/contracts';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { PANEL_OPEN_KEY, PANEL_WIDTH_KEY } from './ai-panel-layout';
import { AiPanelArea } from './AiPanel';

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

// jsdom has no pointer capture; Electron does.
HTMLElement.prototype.setPointerCapture = () => undefined;
HTMLElement.prototype.releasePointerCapture = () => undefined;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
  Reflect.deleteProperty(globalThis, 'ResizeObserver');
});

/** The page renders a text field so focus can start outside the panel. */
const mount = (locale: 'en' | 'es' = 'en') =>
  render(
    <Providers locale={locale}>
      <AiPanelArea
        body={(scope) => (
          <div>
            <p>body slot {scope.kind}</p>
            <textarea id="TxtMeetingChat" aria-label="Message" />
          </div>
        )}
      >
        <input aria-label="Page field" />
      </AiPanelArea>
    </Providers>,
  );

const chip = () => screen.getByTestId('LblMeetingChatScope');
const panel = () => screen.getByTestId('BarMeetingChat');
const launcher = () => screen.queryByRole('button', { name: 'Ask AI' });

/** The body stays mounted while closed so a running send survives; `hidden` hides it. */
const bodyHidden = (): boolean => screen.getByText(/body slot/).closest('[hidden]') !== null;

/** Opens the panel from the launcher once the scope is known. */
async function openFromLauncher(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Ask AI' }));
  await waitFor(() => {
    expect(bodyHidden()).toBe(false);
  });
}

/** A ResizeObserver whose reported width the test sets. */
function installResizeObserver() {
  const observers: { callback: ResizeObserverCallback; target: Element | null }[] = [];
  class FakeResizeObserver {
    private readonly entry: { callback: ResizeObserverCallback; target: Element | null };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, target: null };
      observers.push(this.entry);
    }
    observe(target: Element): void {
      this.entry.target = target;
    }
    unobserve(): void {
      this.entry.target = null;
    }
    disconnect(): void {
      this.entry.target = null;
    }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: FakeResizeObserver,
    configurable: true,
    writable: true,
  });
  return {
    resize: (width: number) => {
      act(() => {
        for (const { callback, target } of observers) {
          if (!target) continue;
          const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry;
          callback([entry], {} as ResizeObserver);
        }
      });
    },
  };
}

describe('AiPanel scope chip (items 6 to 11)', () => {
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
      const { unmount } = mount();
      await waitFor(() => {
        expect(chip().textContent).not.toBe('');
      });
      markup.add(chip().parentElement?.querySelector('svg')?.getAttribute('class') ?? '');
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

describe('AiPanel visibility and toggling', () => {
  it('is hidden entirely on Settings, launcher included, and comes back open after', async () => {
    window.localStorage.setItem(PANEL_OPEN_KEY, 'true');
    const api = install({ currentShellTag: 'Settings' });
    mount();
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'chat.setScope')).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(panel().hidden).toBe(true);
    expect(launcher()).toBeNull();
    await api.change({ currentShellTag: 'Recording' });
    await waitFor(() => {
      expect(panel().hidden).toBe(false);
    });
    expect(launcher()).toBeNull();
  });

  it('starts closed with the launcher, opens from it and focuses the composer', async () => {
    install();
    mount();
    const button = await screen.findByRole('button', { name: 'Ask AI' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(panel().id);
    expect(bodyHidden()).toBe(true);
    await openFromLauncher();
    expect(launcher()).toBeNull();
    expect(document.activeElement?.id).toBe('TxtMeetingChat');
    expect(window.localStorage.getItem(PANEL_OPEN_KEY)).toBe('true');
  });

  it('closes from the header and gives focus back to the launcher', async () => {
    install();
    mount();
    await openFromLauncher();
    await userEvent.click(screen.getByRole('button', { name: 'Close AI panel' }));
    expect(bodyHidden()).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(launcher());
    });
    expect(window.localStorage.getItem(PANEL_OPEN_KEY)).toBe('false');
  });

  it('toggles with Ctrl+J and Ctrl+Shift+J from anywhere in the window', async () => {
    install();
    mount();
    await screen.findByRole('button', { name: 'Ask AI' });
    screen.getByRole('textbox', { name: 'Page field' }).focus();
    await userEvent.keyboard('{Control>}j{/Control}');
    expect(bodyHidden()).toBe(false);
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('TxtMeetingChat');
    });
    await userEvent.keyboard('{Control>}{Shift>}J{/Shift}{/Control}');
    expect(bodyHidden()).toBe(true);
  });

  it('ignores Ctrl+J on Settings', async () => {
    const api = install({ currentShellTag: 'Settings' });
    mount();
    await waitFor(() => {
      expect(api.calls.some((c) => c.name === 'chat.setScope')).toBe(true);
    });
    await userEvent.keyboard('{Control>}j{/Control}');
    expect(window.localStorage.getItem(PANEL_OPEN_KEY)).toBeNull();
  });

  it('restores the open state and width from the last session', async () => {
    window.localStorage.setItem(PANEL_OPEN_KEY, 'true');
    window.localStorage.setItem(PANEL_WIDTH_KEY, '450');
    install();
    mount();
    await waitFor(() => {
      expect(bodyHidden()).toBe(false);
    });
    const handle = screen.getByRole('separator', { name: 'Resize AI panel' });
    expect(handle.getAttribute('aria-valuenow')).toBe('450');
    expect(handle.getAttribute('aria-valuemin')).toBe('320');
    expect(handle.getAttribute('aria-valuemax')).toBe('520');
    handle.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(window.localStorage.getItem(PANEL_WIDTH_KEY)).toBe('466');
    await userEvent.dblClick(handle);
    expect(window.localStorage.getItem(PANEL_WIDTH_KEY)).toBe('380');
  });

  it('stays open when the scope changes, and the chip follows', async () => {
    const api = install({ currentShellTag: 'Session', selectedMeetingId: MEETING });
    mount();
    await openFromLauncher();
    await waitFor(() => {
      expect(chip().textContent).toBe('Meeting: Weekly planning');
    });
    await api.change({ currentShellTag: 'Recording', selectedMeetingId: null });
    await waitFor(() => {
      expect(chip().textContent).toBe('All meetings');
    });
    expect(bodyHidden()).toBe(false);
    expect(screen.getByText('body slot AllMeetings')).toBeTruthy();
  });

  it('New chat starts a chat and remounts the body', async () => {
    const api = install();
    mount();
    await openFromLauncher();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'draft');
    const button = screen.getByTestId<HTMLButtonElement>('BtnMeetingChatNew');
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
    await userEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' }).value).toBe('');
    });
    expect(api.calls.some((c) => c.name === 'chat.newChat')).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('New chat');
  });

  it('names the panel for assistive technology', async () => {
    install();
    mount();
    await openFromLauncher();
    expect(await screen.findByRole('complementary', { name: 'Meeting chat' })).toBeTruthy();
  });
});

describe('AiPanel overlay on narrow windows', () => {
  it('docks on a wide window and floats over the page on a narrow one', async () => {
    const observer = installResizeObserver();
    window.localStorage.setItem(PANEL_OPEN_KEY, 'true');
    install();
    mount();
    await waitFor(() => {
      expect(bodyHidden()).toBe(false);
    });
    observer.resize(1200);
    expect(panel().dataset.mode).toBe('dock');
    expect(screen.getByRole('separator', { name: 'Resize AI panel' })).toBeTruthy();
    observer.resize(900);
    expect(panel().dataset.mode).toBe('overlay');
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('closes with Escape and returns focus to the launcher', async () => {
    const observer = installResizeObserver();
    install();
    mount();
    observer.resize(800);
    await openFromLauncher();
    expect(panel().dataset.mode).toBe('overlay');
    await userEvent.keyboard('{Escape}');
    expect(bodyHidden()).toBe(true);
    await waitFor(() => {
      expect(document.activeElement).toBe(launcher());
    });
  });

  it('closes on a click outside it, but not on one inside', async () => {
    const observer = installResizeObserver();
    install();
    mount();
    observer.resize(800);
    await openFromLauncher();
    await userEvent.click(chip());
    expect(bodyHidden()).toBe(false);
    await userEvent.click(screen.getByRole('textbox', { name: 'Page field' }));
    expect(bodyHidden()).toBe(true);
  });

  it('keeps Escape for the page while docked', async () => {
    install();
    mount();
    await openFromLauncher();
    await userEvent.keyboard('{Escape}');
    expect(bodyHidden()).toBe(false);
  });
});
