// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapsuleView, hintSide, type CapsuleViewProps } from './CapsuleView';

function setMotion(reduced: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

const labels = {
  openApp: 'Open Vozella',
  pause: 'Pause recording',
  resume: 'Resume recording',
  stop: 'Stop recording',
  expand: 'Expand live copilot',
  collapse: 'Collapse live copilot',
  collapseTooltip: 'Collapse',
  statusRecording: 'REC',
  statusPaused: 'Paused',
};

function props(over: Partial<CapsuleViewProps> = {}): CapsuleViewProps {
  return {
    edge: 'Right',
    vertical: true,
    expanded: false,
    rect: { x: 8, y: 8, width: 64, height: 240 },
    contentOpacity: 1,
    paused: false,
    level: 0,
    running: true,
    elapsed: '00:00',
    hint: null,
    labels,
    onOpenApp: vi.fn(),
    onTogglePause: vi.fn(),
    onStop: vi.fn(),
    onToggleExpanded: vi.fn(),
    ...over,
  };
}

const barHeights = (): number[] =>
  Array.from(document.querySelectorAll('[data-bar]')).map((bar) =>
    Number.parseFloat((bar as HTMLElement).style.height),
  );

describe('CapsuleView', () => {
  beforeEach(() => {
    setMotion(false);
  });
  afterEach(cleanup);

  it('lays the six items out in the spec order with the AutomationIds', () => {
    render(<CapsuleView {...props()} />);
    const capsule = screen.getByTestId('LiveCopilotCapsule');
    const order = Array.from(capsule.querySelectorAll('[data-item]')).map((n) =>
      n.getAttribute('data-item'),
    );
    expect(order).toEqual(['logo', 'bars', 'elapsed', 'pause', 'stop', 'chat']);
    expect(screen.getByRole('button', { name: 'Open Vozella' })).toHaveAttribute(
      'id',
      'BtnLiveCopilotLogoOpenApp',
    );
    expect(screen.getByTestId('TxtLiveCopilotElapsed')).toHaveAttribute(
      'id',
      'TxtLiveCopilotElapsed',
    );
    expect(screen.getByRole('button', { name: 'Pause recording' })).toHaveAttribute(
      'id',
      'BtnLiveCopilotPause',
    );
    expect(screen.getByRole('button', { name: 'Stop recording' })).toHaveAttribute(
      'id',
      'BtnLiveCopilotStop',
    );
    expect(screen.getByRole('button', { name: 'Expand live copilot' })).toHaveAttribute(
      'id',
      'BtnLiveCopilotChat',
    );
    // No armed badge: automatic question detection is out of scope.
    expect(document.querySelector('#BadgeLiveCopilotArmed')).toBeNull();
  });

  it('follows the orientation: column on left and right, row on top and bottom', () => {
    const { rerender } = render(<CapsuleView {...props()} />);
    const capsule = screen.getByTestId('LiveCopilotCapsule');
    expect(capsule).toHaveAttribute('data-orientation', 'vertical');
    rerender(<CapsuleView {...props({ vertical: false, edge: 'Top' })} />);
    expect(capsule).toHaveAttribute('data-orientation', 'horizontal');
  });

  it('shows the elapsed time with unbounded minutes and the recording tooltip', () => {
    render(<CapsuleView {...props({ elapsed: '125:03' })} />);
    const text = screen.getByTestId('TxtLiveCopilotElapsed');
    expect(text).toHaveTextContent('125:03');
    expect(text).toHaveAttribute('title', 'REC');
  });

  it('paused: the tooltip says Paused, the button resumes and the bars rest at 3 DIP', () => {
    render(<CapsuleView {...props({ paused: true, level: 90, elapsed: '00:42' })} />);
    expect(screen.getByTestId('TxtLiveCopilotElapsed')).toHaveAttribute('title', 'Paused');
    const button = screen.getByRole('button', { name: 'Resume recording' });
    expect(button).toHaveAttribute('data-glyph', 'play');
    expect(button).toHaveAttribute('title', 'Resume recording');
    expect(barHeights()).toEqual([3, 3, 3, 3, 3]);
  });

  it('recording: the pause glyph shows and the level 0 to 100 maps to the bar heights', () => {
    const { rerender } = render(<CapsuleView {...props({ running: false, level: 0 })} />);
    expect(screen.getByRole('button', { name: 'Pause recording' })).toHaveAttribute(
      'data-glyph',
      'pause',
    );
    expect(barHeights()).toEqual([3, 3, 3, 3, 3]);
    rerender(<CapsuleView {...props({ running: false, level: 100 })} />);
    expect(barHeights()[2]).toBe(24);
    expect(barHeights()[0]).toBeCloseTo(3 + 21 * 0.55, 1);
    rerender(<CapsuleView {...props({ running: false, level: 50 })} />);
    expect(barHeights()[2]).toBeCloseTo(13.5, 1);
  });

  it('the bars run only while running is true (item 59)', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<CapsuleView {...props({ running: true, level: 100 })} />);
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(barHeights()[2]).toBeGreaterThan(3);
      rerender(<CapsuleView {...props({ running: false, level: 100 })} />);
      const frozen = barHeights();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(barHeights()).toEqual(frozen);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the chat button name and tooltip switch with the state and it reports aria-expanded', () => {
    const { rerender } = render(<CapsuleView {...props()} />);
    const collapsed = screen.getByRole('button', { name: 'Expand live copilot' });
    expect(collapsed).toHaveAttribute('aria-expanded', 'false');
    expect(collapsed).toHaveAttribute('title', 'Expand live copilot');
    rerender(<CapsuleView {...props({ expanded: true })} />);
    const open = screen.getByRole('button', { name: 'Collapse live copilot' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).toHaveAttribute('title', 'Collapse');
  });

  it('each button calls its handler', () => {
    const p = props();
    render(<CapsuleView {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Vozella' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand live copilot' }));
    expect(p.onOpenApp).toHaveBeenCalledOnce();
    expect(p.onTogglePause).toHaveBeenCalledOnce();
    expect(p.onStop).toHaveBeenCalledOnce();
    expect(p.onToggleExpanded).toHaveBeenCalledOnce();
  });

  it('marks every button no-drag and the capsule itself as the drag area', () => {
    render(<CapsuleView {...props()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('pill-no-drag');
    }
    expect(screen.getByTestId('LiveCopilotCapsule').className).toContain('pill-drag');
  });

  it('is a full capsule collapsed (radius half the short side) and 28 expanded', () => {
    const { rerender } = render(<CapsuleView {...props()} />);
    const capsule = screen.getByTestId('LiveCopilotCapsule');
    expect(capsule.style.borderRadius).toBe('32px');
    expect(capsule.style.left).toBe('8px');
    expect(capsule.style.width).toBe('64px');
    rerender(<CapsuleView {...props({ expanded: true })} />);
    expect(capsule.style.borderRadius).toBe('28px');
  });

  it('applies the opacity main pushes for the orientation flip', () => {
    render(<CapsuleView {...props({ contentOpacity: 0.25 })} />);
    expect(screen.getByTestId('LiveCopilotCapsule').style.opacity).toBe('0.25');
  });

  it('puts the stop button on the ink token (the signal color is for live state only) and the logo mark in its tile', () => {
    render(<CapsuleView {...props()} />);
    expect(screen.getByRole('button', { name: 'Stop recording' }).className).toContain('bg-ink');
    expect(
      screen.getByRole('button', { name: 'Open Vozella' }).querySelector('svg'),
    ).not.toBeNull();
  });

  it('keeps the stop button on system colors in forced-colors mode', () => {
    render(<CapsuleView {...props()} />);
    const { className } = screen.getByRole('button', { name: 'Stop recording' });
    expect(className).toContain('forced-colors:bg-[Highlight]');
    expect(className).toContain('forced-colors:text-[HighlightText]');
  });

  it('spaces the capsule content by 8 DIP (gap-2 on a 4 px scale)', () => {
    render(<CapsuleView {...props()} />);
    const row = screen.getByTestId('LiveCopilotCapsule').firstElementChild;
    expect(row?.className).toContain('gap-2');
  });

  it('pulses the content from 1 to 1.08 and back, twice, 180 ms each, sine ease in out', () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    try {
      const hint = { id: 1, message: 'Recording started', side: 'left', pulse: true } as const;
      render(<CapsuleView {...props({ hint })} />);
      expect(animate).toHaveBeenCalledTimes(1);
      const [frames, options] = animate.mock.calls[0] as unknown as [
        Keyframe[],
        KeyframeAnimationOptions,
      ];
      expect(frames).toEqual([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }]);
      expect(options).toEqual({
        duration: 180,
        iterations: 2,
        direction: 'alternate',
        easing: 'cubic-bezier(0.37, 0, 0.63, 1)',
      });
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  describe('started hint', () => {
    const hint = { id: 1, message: 'Recording started', side: 'left', pulse: true } as const;

    it('shows the message apart from the logo tooltip, with the pulse', () => {
      render(<CapsuleView {...props({ hint })} />);
      expect(screen.getByRole('status')).toHaveTextContent('Recording started');
      expect(screen.getByRole('status')).toHaveAttribute('data-side', 'left');
      expect(screen.getByRole('button', { name: 'Open Vozella' })).toHaveAttribute(
        'title',
        'Open Vozella',
      );
      expect(screen.getByTestId('LiveCopilotCapsule')).toHaveAttribute('data-pulse', '1');
    });

    it('plays no pulse when the hint says so, and nothing shows without a hint', () => {
      const { rerender } = render(<CapsuleView {...props({ hint: { ...hint, pulse: false } })} />);
      expect(screen.getByTestId('LiveCopilotCapsule')).not.toHaveAttribute('data-pulse');
      rerender(<CapsuleView {...props()} />);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('opens away from the docked edge', () => {
      expect(hintSide('Right')).toBe('left');
      expect(hintSide('Left')).toBe('right');
      expect(hintSide('Top')).toBe('bottom');
      expect(hintSide('Bottom')).toBe('top');
    });
  });
});
