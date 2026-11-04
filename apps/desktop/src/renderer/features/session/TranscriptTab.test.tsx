// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { TooltipProvider } from '../../ui';
import { TranscriptTab, type CopySource } from './TranscriptTab';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const STORED = [
  'Recorded 2026-10-01 22:36',
  'Ended 2026-10-01 23:06',
  '[00:00.00-00:04.52] [ Speaker-1 ] Buenos días.',
  '* [00:04.52-00:09.10] [ Speaker-2 ] Empecemos.',
].join('\n');

type Listener = (payload: unknown) => void;
interface View {
  transcript: string | null | undefined;
  gate?: Promise<void>;
}
interface Fake {
  views: View[];
  fail: boolean;
  calls: string[];
  emit(name: string, payload: unknown): void;
}

function gateOf(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function install(first: string | null | undefined, gate?: Promise<void>): Fake {
  const listeners = new Map<string, Set<Listener>>();
  const fake: Fake = {
    views: [gate ? { transcript: first, gate } : { transcript: first }],
    fail: false,
    calls: [],
    emit: (name, payload) => {
      for (const l of listeners.get(name) ?? []) l(payload);
    },
  };
  let reads = 0;
  (window as unknown as { vozella: unknown }).vozella = {
    invoke: async (name: string, input: Record<string, unknown>) => {
      fake.calls.push(`${name} ${JSON.stringify(input)}`);
      if (name !== 'session.getView') return {};
      const view = fake.views[Math.min(reads, fake.views.length - 1)];
      reads += 1;
      await view?.gate;
      if (fake.fail) throw new Error('disk gone');
      return {
        record: { id: ID, title: 'x', transcript: view?.transcript },
        hasTranscript: true,
        hasAudio: false,
      };
    },
    on: (name: string, listener: Listener) => {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(listener);
      return () => set.delete(listener);
    },
  };
  return fake;
}

function mount(hasAudio = false) {
  const ref: { current: CopySource | null } = { current: null };
  const view = render(
    <I18nProvider>
      <TooltipProvider>
        <TranscriptTab meetingId={ID} copySourceRef={ref} hasAudio={hasAudio} />
      </TooltipProvider>
    </I18nProvider>,
  );
  return { ref, ...view };
}

const reads = (fake: Fake): number =>
  fake.calls.filter((c) => c.startsWith('session.getView')).length;

describe('TranscriptTab', () => {
  afterEach(() => {
    delete (window as unknown as { vozella?: unknown }).vozella;
  });

  it('shows the skeleton first and never the empty message before the read ends', async () => {
    const gate = gateOf();
    install('', gate.promise);
    mount();
    expect(screen.getByTestId('TranscriptLoading')).toBeTruthy();
    expect(screen.queryByTestId('TranscriptEmpty')).toBeNull();
    gate.release();
    await screen.findByTestId('TranscriptEmpty');
  });

  it.each([[''], ['  \r\n\t '], [null], [undefined]])(
    'shows the empty state for %j',
    async (text) => {
      install(text);
      mount();
      await screen.findByTestId('TranscriptEmpty');
      expect(
        screen.getByText("There's no transcript yet. Record or import a meeting first."),
      ).toBeTruthy();
    },
  );

  it('the empty button navigates to Recording', async () => {
    const fake = install('');
    mount();
    await userEvent.click(await screen.findByTestId('BtnTranscriptEmptyRecord'));
    expect(fake.calls.at(-1)).toContain('"navigateTo","tag":"Recording"');
  });

  it('does not select the meeting itself', async () => {
    const fake = install(STORED);
    mount();
    await screen.findByTestId('TxtTranscriptContent');
    expect(fake.calls.some((c) => c.includes('selectMeeting'))).toBe(false);
  });

  it('renders the stored text verbatim, starred prefix included', async () => {
    install(STORED);
    mount();
    const box = await screen.findByTestId('TxtTranscriptContent');
    expect(box.getAttribute('tabindex')).toBe('0');
    const lines = [...box.querySelectorAll('p')].map((p) => p.textContent);
    expect(lines.join('\n')).toBe(STORED);
    expect(lines[3]?.startsWith('* [00:04.52-00:09.10]')).toBe(true);
  });

  it('keeps blank lines as lines', async () => {
    install('a\n\nb');
    mount();
    const box = await screen.findByTestId('TxtTranscriptContent');
    expect(box.querySelectorAll('p')).toHaveLength(3);
  });

  it('the copy source returns the raw transcript, or null without content', async () => {
    install(STORED);
    const first = mount();
    await screen.findByTestId('TxtTranscriptContent');
    await expect(first.ref.current?.()).resolves.toBe(STORED);
    first.unmount();
    expect(first.ref.current).toBeNull();

    install('   ');
    const second = mount();
    await screen.findByTestId('TranscriptEmpty');
    await expect(second.ref.current?.()).resolves.toBeNull();
  });

  it('reloads when this meeting is saved and ignores other meetings', async () => {
    const fake = install('old line');
    fake.views.push({ transcript: 'new line' });
    const { ref } = mount();
    await screen.findByText('old line');
    act(() => {
      fake.emit('workspace.meetingChanged', { id: OTHER });
    });
    expect(reads(fake)).toBe(1);
    act(() => {
      fake.emit('workspace.meetingChanged', { id: ID });
    });
    await screen.findByText('new line');
    await expect(ref.current?.()).resolves.toBe('new line');
  });

  it('drops a stale slow result that lands after a newer one', async () => {
    const gate = gateOf();
    const fake = install('first', gate.promise);
    fake.views.push({ transcript: 'second' });
    mount();
    act(() => {
      fake.emit('workspace.meetingChanged', { id: ID });
    });
    await screen.findByText('second');
    gate.release();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('copy while a reload is pending copies what is displayed', async () => {
    const gate = gateOf();
    const fake = install('shown');
    fake.views.push({ transcript: 'incoming', gate: gate.promise });
    const { ref } = mount();
    await screen.findByText('shown');
    act(() => {
      fake.emit('workspace.meetingChanged', { id: ID });
    });
    await expect(ref.current?.()).resolves.toBe('shown');
    gate.release();
    await screen.findByText('incoming');
  });

  it('shows a quiet error with Retry, and Retry loads again', async () => {
    const fake = install(STORED);
    fake.fail = true;
    mount();
    await screen.findByText('This meeting could not be opened.');
    fake.fail = false;
    await userEvent.click(screen.getByTestId('BtnTranscriptRetry'));
    await waitFor(() => {
      expect(screen.getByTestId('TxtTranscriptContent')).toBeTruthy();
    });
  });

  it('B9: a quiet refresh that fails while the first load is in flight shows the error and Retry', async () => {
    const gate = gateOf();
    const fake = install(STORED, gate.promise);
    mount();
    await waitFor(() => {
      expect(fake.calls.length).toBe(1);
    });
    fake.fail = true;
    act(() => {
      fake.emit('workspace.meetingChanged', { id: ID });
    });
    gate.release();
    await screen.findByText('This meeting could not be opened.');
    fake.fail = false;
    await userEvent.click(screen.getByTestId('BtnTranscriptRetry'));
    await waitFor(() => {
      expect(screen.getByTestId('TxtTranscriptContent')).toBeTruthy();
    });
  });

  it('keeps the text on screen when a quiet refresh fails', async () => {
    const fake = install('stays');
    mount();
    await screen.findByText('stays');
    fake.fail = true;
    act(() => {
      fake.emit('workspace.meetingChanged', { id: ID });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('stays')).toBeTruthy();
  });

  it('renders 20000 lines', async () => {
    const text = Array.from(
      { length: 20_000 },
      (_, i) => `[00:00.00-00:01.00] line ${String(i)}`,
    ).join('\n');
    install(text);
    mount();
    const box = await screen.findByTestId('TxtTranscriptContent', {}, { timeout: 20_000 });
    expect(box.querySelectorAll('p')).toHaveLength(20_000);
  }, 30_000);
});

describe('TranscriptTab audio seeking', () => {
  afterEach(() => {
    delete (window as unknown as { vozella?: unknown }).vozella;
    vi.restoreAllMocks();
  });

  const stub = () => {
    let time = 0;
    const play = vi.fn(() => Promise.resolve());
    Object.defineProperties(HTMLMediaElement.prototype, {
      play: { configurable: true, value: play },
      pause: { configurable: true, value: vi.fn() },
      paused: { configurable: true, get: () => true },
      currentTime: {
        configurable: true,
        get: () => time,
        set: (v: number) => {
          time = v;
        },
      },
    });
    return { play, time: () => time };
  };

  it('a click on a stamped line seeks there and plays', async () => {
    const media = stub();
    install(STORED);
    mount(true);
    const box = await screen.findByTestId('TxtTranscriptContent');
    expect(screen.getByTestId('AudioBar')).toBeTruthy();
    await userEvent.click(screen.getByText(/Empecemos\./));
    expect(media.time()).toBe(4.52);
    expect(media.play).toHaveBeenCalledTimes(1);
    // Header lines carry no stamp: a click does nothing.
    await userEvent.click(screen.getByText('Recorded 2026-10-01 22:36'));
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(box.textContent).toContain('Buenos días.');
  });

  it('a click that ends a text selection does not seek', async () => {
    const media = stub();
    install(STORED);
    mount(true);
    const target = await screen.findByText(/Buenos días\./);
    const range = document.createRange();
    range.selectNodeContents(target);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    // A drag inside one line ends in a click with the selection still in place.
    fireEvent.click(target, { detail: 1 });
    expect(media.play).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
    fireEvent.click(target, { detail: 1 });
    expect(media.play).toHaveBeenCalledTimes(1);
    window.getSelection()?.removeAllRanges();
  });

  it('without audio there is no player and lines do not seek', async () => {
    const media = stub();
    install(STORED);
    mount(false);
    await userEvent.click(await screen.findByText(/Buenos días\./));
    expect(screen.queryByTestId('AudioBar')).toBeNull();
    expect(media.play).not.toHaveBeenCalled();
  });
});
