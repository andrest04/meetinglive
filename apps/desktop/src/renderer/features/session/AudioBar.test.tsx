// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { TooltipProvider } from '../../ui';
import { AudioBar } from './AudioBar';
import { formatClock, useAudioPlayer } from './use-audio-player';

// jsdom has no media pipeline: play, pause and the clock are stubbed on the prototype.
let paused = true;
let time = 0;
const play = vi.fn(() => {
  paused = false;
  return Promise.resolve();
});
const pause = vi.fn(() => {
  paused = true;
});

beforeEach(() => {
  paused = true;
  time = 0;
  play.mockClear();
  pause.mockClear();
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: play },
    pause: { configurable: true, value: pause },
    paused: { configurable: true, get: () => paused },
    currentTime: {
      configurable: true,
      get: () => time,
      set: (v: number) => {
        time = v;
      },
    },
    duration: { configurable: true, get: () => 65 },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function Harness() {
  const player = useAudioPlayer();
  return (
    <>
      <AudioBar player={player} src="vozella://app/media/x" />
      <button
        onClick={() => {
          player.playFrom(42.5);
        }}
      >
        jump
      </button>
    </>
  );
}

const mount = () =>
  render(
    <I18nProvider>
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    </I18nProvider>,
  );

describe('formatClock', () => {
  it('formats minutes, hours and bad input', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('AudioBar', () => {
  it('plays and pauses from a named button', async () => {
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Play audio' }));
    expect(play).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.play(screen.getByTestId('AudioElement'));
    });
    await user.click(screen.getByRole('button', { name: 'Pause audio' }));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('shows the clock and the scrubber follows the element', () => {
    mount();
    const audio = screen.getByTestId('AudioElement');
    act(() => {
      fireEvent.durationChange(audio);
    });
    time = 12.4;
    act(() => {
      fireEvent.timeUpdate(audio);
    });
    expect(screen.getByTestId('AudioClock')).toHaveTextContent('0:12 / 1:05');
    const scrubber = screen.getByRole('slider', { name: 'Audio position' });
    expect(scrubber).toHaveValue('12.4');
    expect(scrubber).toHaveAttribute('aria-valuetext', '0:12 / 1:05');
  });

  it('seeks from the scrubber', () => {
    mount();
    act(() => {
      fireEvent.durationChange(screen.getByTestId('AudioElement'));
    });
    const scrubber = screen.getByRole('slider', { name: 'Audio position' });
    fireEvent.change(scrubber, { target: { value: '30' } });
    expect(time).toBe(30);
  });

  it('playFrom seeks and plays', async () => {
    mount();
    await userEvent.setup().click(screen.getByText('jump'));
    expect(time).toBe(42.5);
    expect(play).toHaveBeenCalled();
  });

  it('the scrubber is disabled until the length is known', () => {
    mount();
    expect(screen.getByRole('slider', { name: 'Audio position' })).toBeDisabled();
  });
});
