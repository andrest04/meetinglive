// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../library/library-test-kit';
import { LiveCanvas, type LiveCanvasProps } from './LiveCanvas';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const base: LiveCanvasProps = {
  heading: 'Live transcript',
  live: true,
  text: '',
  committedLines: 0,
  emptyText: 'Live preview only.',
  highlightFeedback: null,
  statusText: null,
  copied: false,
  onCopy: null,
};

const mount = (props: Partial<LiveCanvasProps> = {}) => {
  const view = render(
    <Providers>
      <LiveCanvas {...base} {...props} />
    </Providers>,
  );
  const again = (next: Partial<LiveCanvasProps>): void => {
    view.rerender(
      <Providers>
        <LiveCanvas {...base} {...props} {...next} />
      </Providers>,
    );
  };
  return { ...view, again };
};

const stamp = (index: number, text: string, star = false): string => {
  const mm = String(Math.floor(index / 6)).padStart(2, '0');
  const ss = String((index % 6) * 10).padStart(2, '0');
  return `${star ? '* ' : ''}[${mm}:${ss}.00-${mm}:${ss}.90] ${text}`;
};

const sizes = (el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop: number) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  el.scrollTop = scrollTop;
};

describe('LiveCanvas heading, badge and placeholder (items 104, 105, 64)', () => {
  it('names the region by its heading and shows the hint when empty', () => {
    mount();
    expect(screen.getByRole('heading', { level: 2, name: 'Live transcript' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Live transcript' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(screen.getByText('Live preview only.')).toBeVisible();
  });

  it('shows the LIVE badge only while live', () => {
    const view = mount({ live: true });
    expect(screen.getByTestId('live-badge')).toHaveTextContent('Live');
    view.again({ live: false, heading: 'Transcript' });
    expect(screen.queryByTestId('live-badge')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Transcript' })).toBeVisible();
  });

  it('draws committed lines in ink and the interim tail quieter, with the speaker', () => {
    mount({
      text: `${stamp(0, 'Hola')}\n[00:10.00-00:11.00] [ Speaker-2 ] Hoy vamos`,
      committedLines: 1,
    });
    const items = screen.getByTestId('canvas-lines').querySelectorAll('li');
    expect(items[0]).toHaveClass('text-ink');
    expect(items[1]).toHaveClass('text-ink-muted');
    expect(screen.getByText('S2')).toBeVisible();
  });

  it('marks a starred line with a screen reader label', () => {
    mount({ text: stamp(0, 'Decision', true), committedLines: 1 });
    expect(screen.getByText('Highlight', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('keeps the text selectable and the content to 760 px', () => {
    mount({ text: stamp(0, 'Hola'), committedLines: 1 });
    expect(screen.getByTestId('live-transcript')).toHaveClass('select-text', 'text-read-lg');
    expect(screen.getByTestId('canvas-lines').parentElement).toHaveClass('max-w-[760px]');
  });
});

describe('live regions (accessibility)', () => {
  it('announces the highlight feedback politely and never the transcript', () => {
    mount({ highlightFeedback: 'Highlighted 00:12.30', text: stamp(0, 'Hola'), committedLines: 1 });
    const feedback = screen.getByTestId('highlight-feedback');
    expect(feedback).toHaveAttribute('aria-live', 'polite');
    expect(feedback).toHaveTextContent('Highlighted 00:12.30');
    expect(screen.getByTestId('live-transcript')).not.toHaveAttribute('aria-live');
    expect(screen.getByTestId('canvas-lines')).not.toHaveAttribute('aria-live');
  });

  it('keeps the Copied bar in a polite status region that exists before it shows', () => {
    const view = mount({ copied: false });
    const region = screen
      .getAllByRole('status')
      .find((el) => el.className.includes('pointer-events-none'));
    expect(region).toBeDefined();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    view.again({ copied: true });
    expect(region).toHaveTextContent('Copied');
    expect(region).toHaveTextContent('Transcript copied to the clipboard.');
  });
});

describe('copy in the heading row (spec 2.6)', () => {
  it('shows only when there is text and calls back', async () => {
    const onCopy = vi.fn();
    const view = mount({ live: false, onCopy });
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    view.again({ text: stamp(0, 'Hola'), committedLines: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledOnce();
  });
});

describe('follow the end and Jump to latest (item 107)', () => {
  it('hides the button while stuck, shows it after scrolling up, and re-sticks on click', async () => {
    const text = Array.from({ length: 30 }, (_, i) => stamp(i, `line ${String(i)}`)).join('\n');
    mount({ text, committedLines: 30 });
    const area = screen.getByTestId('live-transcript');
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();

    sizes(area, 1000, 200, 100);
    fireEvent.scroll(area);
    const jump = await screen.findByRole('button', { name: 'Jump to latest' });

    await userEvent.click(jump);
    expect(area.scrollTop).toBe(area.scrollHeight);
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull();
  });

  it('follows new text while stuck and leaves the reader alone once they scrolled away', () => {
    const lines = (n: number): string =>
      Array.from({ length: n }, (_, i) => stamp(i, `line ${String(i)}`)).join('\n');
    const view = mount({ text: lines(5), committedLines: 5 });
    const area = screen.getByTestId('live-transcript');
    sizes(area, 1000, 200, 800);
    fireEvent.scroll(area);
    sizes(area, 1100, 200, 800);
    view.again({ text: lines(6), committedLines: 6 });
    expect(area.scrollTop).toBe(1100);

    sizes(area, 1100, 200, 100);
    fireEvent.scroll(area);
    sizes(area, 1200, 200, 100);
    view.again({ text: lines(7), committedLines: 7 });
    expect(area.scrollTop).toBe(100);
    expect(screen.getByRole('button', { name: 'Jump to latest' })).toBeVisible();
  });
});

describe('the display holds still while the reader has it (item 106)', () => {
  it('keeps the old text while focused and catches up on blur', () => {
    const view = mount({ text: stamp(0, 'first'), committedLines: 1 });
    const area = screen.getByTestId('live-transcript');
    act(() => {
      area.focus();
    });
    view.again({ text: `${stamp(0, 'first')}\n${stamp(1, 'second')}`, committedLines: 2 });
    expect(area).toHaveTextContent('first');
    expect(area).not.toHaveTextContent('second');
    act(() => {
      area.blur();
    });
    expect(area).toHaveTextContent('second');
  });

  it('holds while text inside is selected and refreshes when the selection clears', () => {
    const view = mount({ text: stamp(0, 'first'), committedLines: 1 });
    const area = screen.getByTestId('live-transcript');
    const range = document.createRange();
    range.selectNodeContents(area.querySelector('li') as HTMLElement);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    view.again({ text: `${stamp(0, 'first')}\n${stamp(1, 'second')}`, committedLines: 2 });
    expect(area).not.toHaveTextContent('second');
    selection?.removeAllRanges();
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(area).toHaveTextContent('second');
  });
});

describe('updates replace the text (items 108, 109)', () => {
  it('replaces a live text with the offline transcript, whatever it was', () => {
    const view = mount({ text: stamp(0, 'live words'), committedLines: 1 });
    view.again({
      heading: 'Transcript',
      live: false,
      text: '[00:00.00-00:02.00] [ Speaker-1 ] Offline words',
      committedLines: Number.POSITIVE_INFINITY,
    });
    const area = screen.getByTestId('live-transcript');
    expect(area).toHaveTextContent('Offline words');
    expect(area).not.toHaveTextContent('live words');
  });

  it('lets an update shrink the text', () => {
    const view = mount({ text: `${stamp(0, 'a')}\n${stamp(1, 'b')}`, committedLines: 2 });
    view.again({ text: stamp(0, 'c'), committedLines: 1 });
    expect(screen.getByTestId('canvas-lines').querySelectorAll('li')).toHaveLength(1);
  });
});

describe('a four-hour transcript stays calm (items 111, B-22)', () => {
  // One phrase every 3 s for 4 hours is 4800 lines; the live pass is 40 phrases a minute at most.
  const LINES = 4800;
  const hours4 = (n: number, star: (i: number) => boolean): string =>
    Array.from({ length: n }, (_, i) =>
      stamp(i, `Frase número ${String(i)} de la reunión larga`, star(i)),
    ).join('\n');

  const measure = () => {
    const commits: { phase: string; actual: number; base: number }[] = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase, actual, base) => {
      commits.push({ phase, actual, base });
    };
    return { commits, onRender };
  };

  it('appends one line without re-rendering the committed ones', () => {
    const { commits, onRender } = measure();
    const full = hours4(LINES, (i) => i % 500 === 0);
    const withTail = (n: number) =>
      `${hours4(LINES, (i) => i % 500 === 0)}\n${stamp(LINES, `tail ${String(n)}`)}`;
    const view = render(
      <Providers>
        <Profiler id="canvas" onRender={onRender}>
          <LiveCanvas {...base} text={full} committedLines={LINES} />
        </Profiler>
      </Providers>,
    );
    expect(screen.getByTestId('canvas-lines').querySelectorAll('li')).toHaveLength(LINES);
    commits.length = 0;
    const updates = 5;
    for (let n = 1; n <= updates; n += 1) {
      view.rerender(
        <Providers>
          <Profiler id="canvas" onRender={onRender}>
            <LiveCanvas {...base} text={withTail(n)} committedLines={LINES} />
          </Profiler>
        </Providers>,
      );
    }
    const updatesOnly = commits.filter((c) => c.phase === 'update');
    expect(updatesOnly.length).toBeGreaterThanOrEqual(updates);
    for (const commit of updatesOnly) {
      // Rendering everything would cost `base`; memoized rows cost a small share of it.
      expect(commit.actual).toBeLessThan(commit.base * 0.1);
      // The render budget for one update, in jsdom on a loaded machine.
      expect(commit.actual).toBeLessThan(150);
    }
    expect(screen.getByTestId('canvas-lines').querySelectorAll('li')).toHaveLength(LINES + 1);
  });

  it('keeps the star pass out of the renderer: stars come from the text main sends', () => {
    mount({ text: hours4(50, (i) => i === 3), committedLines: 50 });
    expect(screen.getAllByText('Highlight', { selector: '.sr-only' })).toHaveLength(1);
  });
});
