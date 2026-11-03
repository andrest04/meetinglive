import { Workspace, type Logger, type WindowScanPort } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import {
  MeetingDetectionController,
  type MainWindowLike,
  type PopupHandle,
} from './meeting-detection-controller';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

interface FakeTimer {
  cb: () => void;
  ms: number;
  cleared: boolean;
}

function setup(options: { popupEnabled?: boolean; settingsFail?: boolean } = {}) {
  const scan = { inCall: false };
  const scanner: WindowScanPort = { anyMeetingWindow: () => Promise.resolve(scan.inCall) };
  const workspace = new Workspace();
  const requestSpy = vi.spyOn(workspace, 'requestTakeNotes');
  const offered = vi.fn();
  workspace.on('callPromptOffered', offered);

  const settings = { meetingPopupEnabled: options.popupEnabled ?? true };
  const load = vi.fn(() => Promise.resolve({ ...settings }));
  const update = vi.fn((patch: { meetingPopupEnabled?: boolean }) => {
    if (options.settingsFail) return Promise.reject(new Error('disk full'));
    Object.assign(settings, patch);
    return Promise.resolve({ ...settings });
  });

  const popupDispose = vi.fn();
  const popup = { shows: 0, hides: 0, events: [] as string[] };
  const popupWindow: PopupHandle = {
    show: () => {
      popup.shows += 1;
      popup.events.push('show');
    },
    hide: () => {
      popup.hides += 1;
      popup.events.push('hide');
    },
    notifyShow: () => popup.events.push('notify-show'),
    notifyHide: (animated) => popup.events.push(animated ? 'notify-hide-animated' : 'notify-hide'),
    dispose: popupDispose,
  };

  const main: MainWindowLike & { minimized: boolean } = {
    minimized: false,
    restore: vi.fn(() => {
      main.minimized = false;
    }),
    show: vi.fn(),
    focus: vi.fn(),
    isMinimized: () => main.minimized,
    isDestroyed: () => false,
  };

  const intervals: FakeTimer[] = [];
  const timeouts: FakeTimer[] = [];
  const broadcast = vi.fn();

  const controller = new MeetingDetectionController({
    scanner,
    workspace,
    settings: { load, update },
    popup: popupWindow,
    getMainWindow: () => main,
    scheduler: {
      setInterval: (cb, ms) => {
        const t = { cb, ms, cleared: false };
        intervals.push(t);
        return () => {
          t.cleared = true;
        };
      },
    },
    setTimeout: (cb, ms) => {
      const t = { cb, ms, cleared: false };
      timeouts.push(t);
      return () => {
        t.cleared = true;
      };
    },
    broadcastPopupSetting: broadcast,
    logger: logger(),
  });
  controller.start();
  const detect = async (inCall: boolean): Promise<void> => {
    scan.inCall = inCall;
    await controller.watcher.tick();
  };
  /** Fires the pending timeout of that length, as the clock would. */
  const fire = (ms: number): void => {
    const t = [...timeouts].reverse().find((x) => x.ms === ms && !x.cleared);
    if (t) {
      t.cleared = true;
      t.cb();
    }
  };
  return {
    controller,
    detect,
    fire,
    popupDispose,
    popup,
    main,
    workspace,
    requestSpy,
    offered,
    settings,
    update,
    intervals,
    timeouts,
    broadcast,
  };
}

describe('MeetingDetectionController', () => {
  it('pauses the auto-hide while the pointer is over the card and restarts it on leave (W8)', async () => {
    const t = setup();
    await t.detect(true);
    const first = t.timeouts.find((x) => x.ms === 30_000);
    t.controller.hover(true);
    expect(first?.cleared).toBe(true);
    t.controller.hover(false);
    const restarted = t.timeouts.filter((x) => x.ms === 30_000 && !x.cleared);
    expect(restarted).toHaveLength(1);
    t.fire(30_000);
    expect(t.popup.events).toContain('notify-hide-animated');
  });

  it('reports whether the popup is showing', async () => {
    const t = setup();
    expect(t.controller.isShown).toBe(false);
    await t.detect(true);
    expect(t.controller.isShown).toBe(true);
    t.controller.dismiss();
    expect(t.controller.isShown).toBe(false);
  });

  it('ignores hover when no popup is showing', () => {
    const t = setup();
    t.controller.hover(false);
    expect(t.timeouts).toHaveLength(0);
  });

  it('starts a 5 s watcher timer and stops it on dispose', () => {
    const t = setup();
    expect(t.intervals).toHaveLength(1);
    expect(t.intervals[0]?.ms).toBe(5000);
    t.controller.dispose();
    expect(t.intervals[0]?.cleared).toBe(true);
    expect(t.popupDispose).toHaveBeenCalled();
  });

  it('shows the popup and offers the in-app prompt when a call is detected', async () => {
    const t = setup();
    await t.detect(true);
    expect(t.popup.events).toEqual(['show', 'notify-show']);
    expect(t.offered).toHaveBeenCalledTimes(1);
  });

  it('shows no popup when the setting is off, but still offers the prompt', async () => {
    const t = setup({ popupEnabled: false });
    await t.detect(true);
    expect(t.popup.shows).toBe(0);
    expect(t.offered).toHaveBeenCalledTimes(1);
  });

  it('shows nothing while a recording is running', async () => {
    const t = setup();
    t.workspace.setCaptureActive(true);
    await t.detect(true);
    expect(t.popup.shows).toBe(0);
    expect(t.offered).not.toHaveBeenCalled();
  });

  it('hides the popup with the exit animation when the call ends', async () => {
    const t = setup();
    await t.detect(true);
    await t.detect(false);
    expect(t.popup.events).toEqual(['show', 'notify-show', 'notify-hide-animated']);
    t.fire(150);
    expect(t.popup.events.at(-1)).toBe('hide');
  });

  it('auto-hides the popup after 30 s with the exit animation', async () => {
    const t = setup();
    await t.detect(true);
    t.fire(30_000);
    expect(t.popup.events.at(-1)).toBe('notify-hide-animated');
    t.fire(150);
    expect(t.popup.hides).toBe(1);
  });

  it('start: hides without animation, restores and focuses the main window, requests a blank take', async () => {
    const t = setup();
    await t.detect(true);
    t.main.minimized = true;
    t.controller.startTakingNotes();
    expect(t.popup.events.slice(2)).toEqual(['notify-hide', 'hide']);
    expect(t.main.restore).toHaveBeenCalled();
    expect(t.main.focus).toHaveBeenCalled();
    expect(t.requestSpy).toHaveBeenCalledWith();
  });

  it('start does not restore a window that is not minimized', async () => {
    const t = setup();
    await t.detect(true);
    t.controller.startTakingNotes();
    expect(t.main.restore).not.toHaveBeenCalled();
    expect(t.main.focus).toHaveBeenCalled();
  });

  it('start still requests the take when the main window is gone', () => {
    const t = setup();
    const controller = new MeetingDetectionController({
      scanner: { anyMeetingWindow: () => Promise.resolve(false) },
      workspace: t.workspace,
      settings: { load: () => Promise.resolve({ meetingPopupEnabled: true }), update: vi.fn() },
      popup: {
        show: vi.fn(),
        hide: vi.fn(),
        notifyShow: vi.fn(),
        notifyHide: vi.fn(),
        dispose: vi.fn(),
      },
      getMainWindow: () => null,
      scheduler: { setInterval: () => () => undefined },
      setTimeout: () => () => undefined,
      broadcastPopupSetting: vi.fn(),
      logger: logger(),
    });
    controller.startTakingNotes();
    expect(t.requestSpy).toHaveBeenCalledWith();
  });

  it('dismiss hides with the exit animation and requests nothing', async () => {
    const t = setup();
    await t.detect(true);
    t.controller.dismiss();
    expect(t.popup.events.slice(2)).toEqual(['notify-hide-animated']);
    t.fire(150);
    expect(t.popup.hides).toBe(1);
    expect(t.requestSpy).not.toHaveBeenCalled();
  });

  it('never again: hides, turns the setting off, and tells the windows', async () => {
    const t = setup();
    await t.detect(true);
    await t.controller.neverAgain();
    expect(t.popup.events).toContain('notify-hide-animated');
    expect(t.settings.meetingPopupEnabled).toBe(false);
    expect(t.update).toHaveBeenCalledWith({ meetingPopupEnabled: false });
    expect(t.broadcast).toHaveBeenCalledWith(false);
  });

  it('never again skips the write when the setting is already off', async () => {
    const t = setup({ popupEnabled: false });
    await t.controller.neverAgain();
    expect(t.update).not.toHaveBeenCalled();
    expect(t.broadcast).not.toHaveBeenCalled();
  });

  it('never again swallows a failing write', async () => {
    const t = setup({ settingsFail: true });
    await expect(t.controller.neverAgain()).resolves.toBeUndefined();
    expect(t.broadcast).not.toHaveBeenCalled();
  });

  it('dismisses the popup when a recording starts from any path', async () => {
    const t = setup();
    await t.detect(true);
    t.workspace.setCaptureActive(true);
    expect(t.popup.events.slice(2)).toEqual(['notify-hide-animated']);
    // Stopping the recording does not touch the popup again.
    t.workspace.setCaptureActive(false);
    expect(t.popup.events).toHaveLength(3);
  });

  it('stops listening to the workspace after dispose', async () => {
    const t = setup();
    await t.detect(true);
    t.controller.dispose();
    const before = t.popup.events.length;
    t.workspace.setCaptureActive(true);
    expect(t.popup.events).toHaveLength(before);
  });
});
