import { describe, expect, it, vi } from 'vitest';
import { RecordingHandoff, type HandoffEvent } from './recording-handoff';

function setup(destroyed = false) {
  const calls: string[] = [];
  const events: HandoffEvent[] = [];
  const main = {
    isDestroyed: () => destroyed,
    minimize: () => calls.push('minimize'),
  };
  const handoff = new RecordingHandoff({
    getMainWindow: () => main,
    dismissPopup: () => calls.push('dismissPopup'),
  });
  handoff.onHandoff((event) => events.push(event));
  return { handoff, calls, events };
}

describe('RecordingHandoff (items 76, 77, 78)', () => {
  it('on the false to true change: dismisses the popup, minimizes, and shows the hint', () => {
    const { handoff, calls, events } = setup();
    handoff.update(true);
    expect(calls).toEqual(['dismissPopup', 'minimize']);
    expect(events).toEqual([
      { isRecording: true, mainWindowActive: false, showStartedHint: true, showPill: true },
    ]);
  });

  it('treats the main window as inactive right after minimizing (item 78)', () => {
    const { handoff } = setup();
    expect(handoff.mainWindowActive).toBe(true);
    handoff.update(true);
    expect(handoff.mainWindowActive).toBe(false);
  });

  it('shows the pill during the handoff even if the window still reads as active', () => {
    const { handoff, events } = setup();
    handoff.update(true);
    // A late focus event after the minimize must not hide the pill.
    handoff.setMainWindowActive(true);
    handoff.setMainWindowActive(false);
    expect(events[0]?.showPill).toBe(true);
  });

  it('does not minimize again while the recording continues (pause, resume)', () => {
    const { handoff, calls } = setup();
    handoff.update(true);
    calls.length = 0;
    handoff.update(true);
    handoff.update(true);
    expect(calls).toEqual(['dismissPopup', 'dismissPopup']);
  });

  it('does not minimize or hint on stop, and hides the pill', () => {
    const { handoff, calls, events } = setup();
    handoff.update(true);
    calls.length = 0;
    events.length = 0;
    handoff.update(false);
    expect(calls).toEqual([]);
    expect(events).toEqual([
      { isRecording: false, mainWindowActive: false, showStartedHint: false, showPill: false },
    ]);
  });

  it('minimizes again for the next take', () => {
    const { handoff, calls } = setup();
    handoff.update(true);
    handoff.update(false);
    calls.length = 0;
    handoff.update(true);
    expect(calls).toContain('minimize');
  });

  it('does nothing to a destroyed window but still marks it inactive', () => {
    const { handoff, calls } = setup(true);
    handoff.update(true);
    expect(calls).toEqual(['dismissPopup']);
    expect(handoff.mainWindowActive).toBe(false);
  });

  it('follows focus: the pill shows while recording and the main window is not active', () => {
    const { handoff, events } = setup();
    handoff.update(true);
    events.length = 0;
    handoff.setMainWindowActive(true);
    handoff.setMainWindowActive(false);
    expect(events.map((e) => e.showPill)).toEqual([false, true]);
    expect(events.every((e) => !e.showStartedHint)).toBe(true);
  });

  it('is silent when the focus state does not change', () => {
    const { handoff, events } = setup();
    handoff.setMainWindowActive(true);
    expect(events).toEqual([]);
  });

  it('does not show the pill while idle, whatever the focus (item 79)', () => {
    const { handoff, events } = setup();
    handoff.setMainWindowActive(false);
    expect(events[0]?.showPill).toBe(false);
  });
});

describe('RecordingHandoff seam', () => {
  it('lets a listener unsubscribe', () => {
    const { handoff } = setup();
    const listener = vi.fn();
    const off = handoff.onHandoff(listener);
    handoff.update(true);
    off();
    handoff.update(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('RecordingHandoff secondary windows (item 89)', () => {
  it('closes every registered window when asked, once', () => {
    const { handoff } = setup();
    const close = vi.fn();
    handoff.registerSecondary({ isDestroyed: () => false, close });
    handoff.closeSecondary();
    handoff.closeSecondary();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('skips destroyed windows and honours unregister', () => {
    const { handoff } = setup();
    const gone = vi.fn();
    const removed = vi.fn();
    handoff.registerSecondary({ isDestroyed: () => true, close: gone });
    handoff.registerSecondary({ isDestroyed: () => false, close: removed })();
    handoff.closeSecondary();
    expect(gone).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
  });
});
