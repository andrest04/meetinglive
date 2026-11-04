import { pillHint, pillStateChanged, type PillStateDto } from '@vozella/contracts';
import { STARTED_HINT_DURATION_MS, type DockState, type Rect } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { PillMoveEvent, PillWindowPort } from '../windows/pill-window';
import {
  PillController,
  type PillClock,
  type PillControllerDeps,
  type PillDisplay,
} from './pill-controller';

// Work area of a 1920x1020 display at 125%: 1536x816 DIP, the numbers the window spike measured.
const AREA: Rect = { x: 0, y: 0, width: 1536, height: 816 };
const GUTTER = 8;
// Right edge, along 0.5: capsule 64x240 at (1456, 288); the window adds the 8 DIP gutter.
const RIGHT_DOCKED: Rect = { x: 1448, y: 280, width: 80, height: 256 };
const LEFT_TOP_DOCKED: Rect = { x: 8, y: 8, width: 80, height: 256 };

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

class FakeClock implements PillClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<
    number,
    { at: number; every: number | null; run: () => void }
  >();

  now = (): number => this.time;

  setTimeout = (run: () => void, ms: number): (() => void) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, every: null, run });
    return () => {
      this.timers.delete(id);
    };
  };

  setInterval = (run: () => void, ms: number): (() => void) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, every: ms, run });
    return () => {
      this.timers.delete(id);
    };
  };

  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= end && timer.at < nextAt) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const timer = this.timers.get(nextId);
      if (!timer) break;
      this.time = Math.max(this.time, timer.at);
      if (timer.every === null) this.timers.delete(nextId);
      else timer.at += timer.every;
      timer.run();
    }
    this.time = end;
  }
}

function fakeWindow(id = 5) {
  let bounds: Rect = { x: 0, y: 0, width: 80, height: 256 };
  let visible = false;
  let destroyed = false;
  let resolveLoaded: () => void = () => undefined;
  const loaded = new Promise<void>((resolve) => {
    resolveLoaded = resolve;
  });
  let willMove: (event: PillMoveEvent) => void = () => undefined;
  let moved: () => void = () => undefined;
  let closed: () => void = () => undefined;
  let boundsChanged: () => void = () => undefined;
  const sent: { name: string; payload: unknown }[] = [];
  const boundsLog: Rect[] = [];
  const hides = { count: 0 };
  const win: PillWindowPort = {
    webContentsId: id,
    setBounds: (next) => {
      bounds = next;
      boundsLog.push(next);
    },
    getBounds: () => bounds,
    showInactive: () => {
      visible = true;
    },
    hide: () => {
      visible = false;
      hides.count += 1;
    },
    isVisible: () => visible,
    isDestroyed: () => destroyed,
    close: () => {
      destroyed = true;
      closed();
    },
    whenLoaded: () => loaded,
    send: (channel, payload) => {
      sent.push({ name: channel.name, payload });
    },
    onWillMove: (listener) => {
      willMove = listener;
    },
    onMoved: (listener) => {
      moved = listener;
    },
    onBoundsChanged: (listener) => {
      boundsChanged = listener;
    },
    onClosed: (listener) => {
      closed = listener;
    },
  };
  return {
    win,
    sent,
    boundsLog,
    hides,
    finishLoad: resolveLoaded,
    setBounds: (next: Rect) => {
      bounds = next;
    },
    /** Simulates one OS move event of the drag loop; returns whether the controller blocked it. */
    drag: (next: Rect): boolean => {
      const outcome = { prevented: false };
      willMove({
        newBounds: next,
        preventDefault: () => {
          outcome.prevented = true;
        },
      });
      if (!outcome.prevented) bounds = next;
      return outcome.prevented;
    },
    endDrag: () => {
      moved();
    },
    /** The OS moved or resized the window on its own (a snap, a forced size). */
    osChanged: (next: Rect) => {
      bounds = next;
      boundsChanged();
    },
    states: (): PillStateDto[] =>
      sent.filter((m) => m.name === pillStateChanged.name).map((m) => m.payload as PillStateDto),
    hints: () =>
      sent
        .filter((m) => m.name === pillHint.name)
        .map((m) => m.payload as { show: boolean; durationMs: number; pulse: boolean }),
  };
}

type FakeWin = ReturnType<typeof fakeWindow>;

interface SetupOptions {
  animations?: boolean;
  load?: () => Promise<DockState>;
  displays?: PillDisplay[];
  minimize?: boolean;
  autoLoad?: boolean;
}

function setup(options: SetupOptions = {}) {
  const clock = new FakeClock();
  const windows: FakeWin[] = [];
  const animations = options.animations ?? false;
  const displays = options.displays ?? [{ id: 1, workArea: AREA, bounds: AREA }];
  let displayListener: () => void = () => undefined;
  const store = {
    load: vi.fn(
      options.load ?? ((): Promise<DockState> => Promise.resolve({ edge: 'Right', along: 0.5 })),
    ),
    save: vi.fn((_state: DockState): Promise<void> => Promise.resolve()),
  };
  const handoff = {
    dismissMeetingPopup: vi.fn(),
    minimizeMainWindow: vi.fn(() => options.minimize ?? true),
  };
  const warn = vi.fn();
  const trusted: number[] = [];
  const deps: PillControllerDeps = {
    createWindow: () => {
      const fake = fakeWindow(windows.length + 5);
      windows.push(fake);
      if (options.autoLoad !== false) fake.finishLoad();
      return fake.win;
    },
    screen: {
      primaryWorkArea: () => AREA,
      displayAt: (point) =>
        displays.find(
          (d) =>
            point.x >= d.bounds.x &&
            point.x < d.bounds.x + d.bounds.width &&
            point.y >= d.bounds.y &&
            point.y < d.bounds.y + d.bounds.height,
        ) ?? { id: 0, workArea: AREA, bounds: AREA },
      allDisplays: () => displays,
      onDisplayChanged: (listener) => {
        displayListener = listener;
        return () => undefined;
      },
    },
    clock,
    dock: store,
    animationsEnabled: () => animations,
    trustSender: (id) => trusted.push(id),
    handoff,
    logger: { warn },
  };
  const controller = new PillController(deps);
  return {
    controller,
    clock,
    windows,
    store,
    handoff,
    warn,
    trusted,
    displayChanged: () => {
      displayListener();
    },
    win: (): FakeWin => {
      const first = windows[0];
      if (!first) throw new Error('no window yet');
      return first;
    },
  };
}

type Setup = ReturnType<typeof setup>;

/** Recording starts, the handoff minimizes the main window, the pill is up. */
async function startRecording(t: Setup): Promise<void> {
  t.controller.onRecordingState(true);
  await flush();
}

/** The main window comes forward, then goes away again. */
async function bounce(t: Setup): Promise<void> {
  t.controller.setMainWindowActive(true);
  await flush();
  t.controller.setMainWindowActive(false);
  await flush();
}

describe('pill visibility rule', () => {
  it('creates nothing until the pill is needed, and hiding a pill that never existed does nothing', async () => {
    const t = setup();
    t.controller.setMainWindowActive(true);
    t.controller.onRecordingState(false);
    t.controller.setMainWindowActive(false);
    await flush();
    expect(t.windows).toHaveLength(0);
  });

  it('is visible on the start handoff and keeps one window for the whole process', async () => {
    const t = setup();
    await startRecording(t);
    expect(t.windows).toHaveLength(1);
    expect(t.win().win.isVisible()).toBe(true);
    expect(t.trusted).toEqual([5]);
    await bounce(t);
    expect(t.windows).toHaveLength(1);
    expect(t.win().win.isVisible()).toBe(true);
  });

  it.each([
    { recording: false, active: true, shown: false },
    { recording: false, active: false, shown: false },
    { recording: true, active: true, shown: false },
    { recording: true, active: false, shown: true },
  ])('recording $recording, main active $active gives visible $shown', async (row) => {
    // A main window that cannot minimize leaves `active` as the tests set it.
    const t = setup({ minimize: false });
    if (row.recording) {
      t.controller.onRecordingState(true);
      await flush();
    }
    t.controller.setMainWindowActive(row.active);
    await flush();
    expect(t.windows[0]?.win.isVisible() ?? false).toBe(row.shown);
  });

  it('starts with the main window active: a take that starts without a minimize shows no pill', async () => {
    const t = setup({ minimize: false });
    t.controller.onRecordingState(true);
    await flush();
    expect(t.windows[0]?.win.isVisible() ?? false).toBe(false);
  });

  it('keeps the pill while paused: only isRecording matters', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.onRecordingState(true);
    await flush();
    expect(t.win().win.isVisible()).toBe(true);
  });

  it('bug 14: when the main window cannot be minimized, the pill is re-evaluated at once', async () => {
    const t = setup({ minimize: false });
    await startRecording(t);
    expect(t.handoff.minimizeMainWindow).toHaveBeenCalledTimes(1);
    expect(t.windows[0]?.win.isVisible() ?? false).toBe(false);
    // And the next focus change still drives it.
    t.controller.setMainWindowActive(false);
    await flush();
    expect(t.win().win.isVisible()).toBe(true);
  });

  it('closes the pill with the main window', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.dispose();
    expect(t.win().win.isDestroyed()).toBe(true);
  });

  it('forgets a window the OS closed and makes a new one at the next show', async () => {
    const t = setup();
    await startRecording(t);
    t.win().win.close();
    await bounce(t);
    expect(t.windows).toHaveLength(2);
    expect(t.windows[1]?.win.isVisible()).toBe(true);
  });
});

describe('recording handoff', () => {
  it('on the false to true transition dismisses the popup, minimizes and asks for the hint', async () => {
    const t = setup();
    t.controller.onRecordingState(true);
    expect(t.handoff.dismissMeetingPopup).toHaveBeenCalledTimes(1);
    expect(t.handoff.minimizeMainWindow).toHaveBeenCalledTimes(1);
    await flush();
    expect(t.win().hints()).toEqual([
      expect.objectContaining({ show: true, durationMs: STARTED_HINT_DURATION_MS }),
    ]);
  });

  it('is not repeated on pause, resume, stop, discard or import (isRecording unchanged or falling)', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.onRecordingState(true); // pause
    t.controller.onRecordingState(true); // resume
    t.controller.onRecordingState(false); // stop
    t.controller.onRecordingState(false); // processing, discard, import
    await flush();
    expect(t.handoff.minimizeMainWindow).toHaveBeenCalledTimes(1);
    expect(t.handoff.dismissMeetingPopup).toHaveBeenCalledTimes(1);
  });

  it('a second recording hands off again', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.onRecordingState(false);
    await flush();
    await startRecording(t);
    expect(t.handoff.minimizeMainWindow).toHaveBeenCalledTimes(2);
    expect(t.win().win.isVisible()).toBe(true);
  });
});

describe('show and hide races', () => {
  function slowLoad() {
    let release: (value: DockState) => void = () => undefined;
    const load = (): Promise<DockState> =>
      new Promise<DockState>((resolve) => {
        release = resolve;
      });
    return { load, release: (value: DockState) => release(value) };
  }

  it('the latest request wins: hide while the dock is loading never shows the pill', async () => {
    const slow = slowLoad();
    const t = setup({ load: slow.load });
    t.controller.onRecordingState(true);
    await flush();
    t.controller.setMainWindowActive(true); // main comes forward: hide
    slow.release({ edge: 'Left', along: 0.2 });
    await flush();
    expect(t.windows[0]?.win.isVisible() ?? false).toBe(false);
  });

  it('show, hide, show during the load shows once, on the loaded dock', async () => {
    const slow = slowLoad();
    const t = setup({ load: slow.load });
    t.controller.onRecordingState(true);
    t.controller.setMainWindowActive(true);
    t.controller.setMainWindowActive(false);
    slow.release({ edge: 'Left', along: 0 });
    await flush();
    expect(t.windows).toHaveLength(1);
    expect(t.win().win.isVisible()).toBe(true);
    // Left edge, along 0: capsule at (16, 16), window outset by the gutter.
    expect(t.win().win.getBounds()).toEqual(LEFT_TOP_DOCKED);
  });

  it('showing again while visible is a no-op', async () => {
    const t = setup();
    await startRecording(t);
    const calls = t.win().boundsLog.length;
    t.controller.setMainWindowActive(false);
    await flush();
    expect(t.win().boundsLog).toHaveLength(calls);
    expect(t.windows).toHaveLength(1);
  });

  it('waits for the page to load before showing', async () => {
    const t = setup({ autoLoad: false });
    t.controller.onRecordingState(true);
    await flush();
    expect(t.win().win.isVisible()).toBe(false);
    t.win().finishLoad();
    await flush();
    expect(t.win().win.isVisible()).toBe(true);
  });

  it('bug 13: a failing dock load is logged, the defaults apply, and the next show retries', async () => {
    let attempts = 0;
    const t = setup({
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('settings busy'))
          : Promise.resolve({ edge: 'Left', along: 0 });
      },
    });
    await startRecording(t);
    expect(t.warn).toHaveBeenCalled();
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
    await bounce(t);
    expect(attempts).toBe(2);
    expect(t.win().win.getBounds()).toEqual(LEFT_TOP_DOCKED);
  });

  it('reads the dock once per process when it worked', async () => {
    const t = setup();
    await startRecording(t);
    await bounce(t);
    await bounce(t);
    expect(t.store.load).toHaveBeenCalledTimes(1);
  });

  it('does not let a late load overwrite a dock the user already chose', async () => {
    let attempts = 0;
    const t = setup({
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('busy'))
          : Promise.resolve({ edge: 'Left', along: 0 });
      },
    });
    await startRecording(t);
    // The user drags to the bottom: that is the dock now.
    t.win().drag({ x: 700, y: 700, width: 80, height: 256 });
    t.win().endDrag();
    await bounce(t);
    expect(attempts).toBe(2);
    expect(t.win().states().at(-1)?.edge).toBe('Bottom');
  });

  it('an error in the async path is logged, never unhandled (bug 13)', async () => {
    const t = setup();
    await startRecording(t);
    t.win().win.setBounds = () => {
      throw new Error('window gone');
    };
    t.controller.setMainWindowActive(true); // the hide moves the window back and throws
    await flush();
    expect(t.warn).toHaveBeenCalledWith('pill visibility failed', expect.anything());
  });
});

describe('entrance and exit', () => {
  it('slides in over 300 ms from past the edge, with opacity following the eased progress', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    const win = t.win();
    // Starts off screen: past the right edge by its width plus the margin.
    expect(win.boundsLog.at(-1)).toEqual({ ...RIGHT_DOCKED, x: RIGHT_DOCKED.x + 80 + 16 });
    expect(win.states().at(-1)?.opacity).toBe(0);
    t.clock.advance(160);
    const mid = win.states().at(-1);
    expect(mid?.opacity).toBeGreaterThan(0.9); // easeOutQuint is fast early
    expect(mid?.opacity).toBeLessThan(1);
    t.clock.advance(200);
    expect(win.win.getBounds()).toEqual(RIGHT_DOCKED);
    expect(win.states().at(-1)).toMatchObject({ opacity: 1, visible: true });
  });

  it('slides out over 160 ms, then hides and moves the hidden window back to the docked place', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    t.controller.setMainWindowActive(true);
    await flush();
    const win = t.win();
    expect(win.win.isVisible()).toBe(true);
    t.clock.advance(80);
    expect(win.win.getBounds().x).toBeGreaterThan(RIGHT_DOCKED.x);
    expect(win.win.isVisible()).toBe(true);
    t.clock.advance(200);
    expect(win.win.isVisible()).toBe(false);
    expect(win.win.getBounds()).toEqual(RIGHT_DOCKED);
    expect(win.states().at(-1)).toMatchObject({ visible: false, opacity: 1 });
  });

  it('showing during the exit cancels it and the pill stays', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    t.controller.setMainWindowActive(true);
    await flush();
    t.clock.advance(80);
    t.controller.setMainWindowActive(false);
    await flush();
    t.clock.advance(1000);
    expect(t.win().win.isVisible()).toBe(true);
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
    expect(t.win().hides.count).toBe(0);
  });

  it('with the OS animations off, show and hide are immediate', async () => {
    const t = setup({ animations: false });
    await startRecording(t);
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
    expect(t.win().states().at(-1)).toMatchObject({
      visible: true,
      opacity: 1,
      animationsEnabled: false,
    });
    expect(t.clock.pending).toBe(1); // only the hint timer, no tween
    t.controller.setMainWindowActive(true);
    await flush();
    expect(t.win().win.isVisible()).toBe(false);
  });

  it('keeps a hidden window off the neighbouring monitor (bug 11)', async () => {
    const right: Rect = { x: 1536, y: 0, width: 1536, height: 816 };
    const t = setup({
      animations: true,
      displays: [
        { id: 1, workArea: AREA, bounds: AREA },
        { id: 2, workArea: right, bounds: right },
      ],
    });
    await startRecording(t);
    const start = t.win().boundsLog.at(-1);
    expect(start && start.x + start.width).toBeLessThanOrEqual(AREA.width);
    t.clock.advance(400);
    t.controller.setMainWindowActive(true);
    await flush();
    for (let i = 0; i < 12; i++) {
      t.clock.advance(16);
      const b = t.win().win.getBounds();
      expect(b.x + b.width).toBeLessThanOrEqual(AREA.width);
    }
  });
});

describe('placement', () => {
  it('first placement uses the primary work area, after moving the window to its origin', async () => {
    const t = setup();
    await startRecording(t);
    const [first, second] = t.win().boundsLog;
    expect(first).toMatchObject({ x: 0, y: 0 });
    expect(second).toEqual(RIGHT_DOCKED);
  });

  it('later placements use the display nearest the window', async () => {
    const second: Rect = { x: 1536, y: 0, width: 1536, height: 816 };
    const t = setup({
      displays: [
        { id: 1, workArea: AREA, bounds: AREA },
        { id: 2, workArea: second, bounds: second },
      ],
    });
    await startRecording(t);
    t.controller.setMainWindowActive(true);
    await flush();
    // The window sits on the second monitor now.
    t.win().setBounds({ x: 2800, y: 280, width: 80, height: 256 });
    t.controller.setMainWindowActive(false);
    await flush();
    expect(t.win().win.getBounds().x).toBeGreaterThanOrEqual(1536);
  });

  it('item 52: the size the OS grants is what the page is told', async () => {
    const t = setup();
    await startRecording(t);
    const granted = t.win().win.getBounds();
    expect(t.win().states().at(-1)?.window).toEqual({
      width: granted.width,
      height: granted.height,
    });
  });

  it('tells the page where the capsule is inside the window', async () => {
    const t = setup();
    await startRecording(t);
    expect(t.win().states().at(-1)).toMatchObject({
      edge: 'Right',
      vertical: true,
      expanded: false,
      capsule: { x: GUTTER, y: GUTTER, width: 64, height: 240 },
      panel: null,
    });
  });
});

describe('panel', () => {
  it('opening grows the window toward the center and keeps the capsule where it was', async () => {
    const t = setup();
    await startRecording(t);
    const state = t.controller.setExpanded(true);
    // Worked example: width 64 + 8 + 380 = 452, height 500, capsule centred on the window.
    expect(t.win().win.getBounds()).toEqual({
      x: 1456 + 64 - 452 - GUTTER,
      y: 288 + Math.trunc((240 - 500) / 2) - GUTTER,
      width: 452 + 2 * GUTTER,
      height: 500 + 2 * GUTTER,
    });
    expect(state.expanded).toBe(true);
    // The capsule keeps its screen position.
    const bounds = t.win().win.getBounds();
    expect(bounds.x + state.capsule.x).toBe(1456);
    expect(bounds.y + state.capsule.y).toBe(288);
    expect(state.panel).toEqual({ x: GUTTER, y: GUTTER, width: 380, height: 500 });
  });

  it('closing is instant', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    t.controller.setExpanded(true);
    const state = t.controller.setExpanded(false);
    expect(state.expanded).toBe(false);
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
    expect(t.clock.pending).toBe(1); // only the hint timer
  });

  it('survives hide and show when the main window only comes forward', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.setExpanded(true);
    t.controller.setMainWindowActive(true);
    await flush();
    expect(t.win().win.isVisible()).toBe(false);
    t.controller.setMainWindowActive(false);
    await flush();
    expect(t.win().states().at(-1)?.expanded).toBe(true);
    expect(t.win().win.getBounds().width).toBe(452 + 2 * GUTTER);
  });

  it('folds back only when the recording stops', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.setExpanded(true);
    t.controller.onRecordingState(false);
    await flush();
    expect(t.controller.state.expanded).toBe(false);
    await startRecording(t);
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
  });

  it('keeps the flag when the panel is opened while the pill is hidden', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.setMainWindowActive(true);
    await flush();
    const state = t.controller.setExpanded(true);
    expect(state.expanded).toBe(true);
    t.controller.setMainWindowActive(false);
    await flush();
    expect(t.win().win.getBounds().width).toBe(452 + 2 * GUTTER);
  });
});

describe('started hint', () => {
  it('waits for the entrance to finish', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    expect(t.win().hints()).toEqual([]);
    t.clock.advance(299);
    expect(t.win().hints()).toEqual([]);
    t.clock.advance(20);
    expect(t.win().hints()).toEqual([expect.objectContaining({ show: true, pulse: true })]);
  });

  it('is immediate with animations off, without a pulse, and closes after 2500 ms', async () => {
    const t = setup({ animations: false });
    await startRecording(t);
    expect(t.win().hints()).toEqual([expect.objectContaining({ show: true, pulse: false })]);
    t.clock.advance(STARTED_HINT_DURATION_MS - 1);
    expect(t.win().hints()).toHaveLength(1);
    t.clock.advance(2);
    expect(t.win().hints().at(-1)).toMatchObject({ show: false });
  });

  it('is cancelled by a hide before the entrance ends', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(100);
    t.controller.setMainWindowActive(true);
    await flush();
    t.clock.advance(2000);
    expect(
      t
        .win()
        .hints()
        .some((h) => h.show),
    ).toBe(false);
  });

  it('is cancelled when a drag starts', async () => {
    const t = setup();
    await startRecording(t);
    t.win().drag({ x: 1400, y: 300, width: 80, height: 256 });
    expect(t.win().hints().at(-1)).toMatchObject({ show: false });
    t.clock.advance(5000);
    expect(
      t
        .win()
        .hints()
        .filter((h) => h.show),
    ).toHaveLength(1);
  });

  it('is cancelled when the window is closed', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(50);
    t.win().win.close();
    t.clock.advance(5000);
    expect(
      t
        .win()
        .hints()
        .some((h) => h.show),
    ).toBe(false);
  });

  it('is not requested when the pill returns after the main window left again', async () => {
    const t = setup();
    await startRecording(t);
    await bounce(t);
    expect(
      t
        .win()
        .hints()
        .filter((h) => h.show),
    ).toHaveLength(1);
  });
});

describe('dock persistence', () => {
  async function snapped() {
    const t = setup();
    await startRecording(t);
    t.win().drag({ x: 700, y: 20, width: 80, height: 256 });
    t.win().endDrag();
    return t;
  }

  it('saves 500 ms after a snap', async () => {
    const t = await snapped();
    t.clock.advance(499);
    expect(t.store.save).not.toHaveBeenCalled();
    t.clock.advance(2);
    expect(t.store.save).toHaveBeenCalledTimes(1);
    expect(t.store.save).toHaveBeenCalledWith(expect.objectContaining({ edge: 'Top' }));
  });

  it('debounces two snaps into one save', async () => {
    const t = await snapped();
    t.clock.advance(300);
    t.win().drag({ x: 300, y: 10, width: 288, height: 80 });
    t.win().endDrag();
    t.clock.advance(1000);
    expect(t.store.save).toHaveBeenCalledTimes(1);
  });

  it('saves before the exit animation starts, and waits for the write', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    t.win().drag({ x: 700, y: 20, width: 80, height: 256 });
    t.win().endDrag();
    t.clock.advance(400);
    t.store.save.mockClear();
    let finish: () => void = () => undefined;
    t.store.save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    t.controller.setMainWindowActive(true);
    await flush();
    const before = t.win().win.getBounds();
    t.clock.advance(200);
    expect(t.store.save).toHaveBeenCalledTimes(1);
    expect(t.win().win.getBounds()).toEqual(before); // no exit tween while the write is pending
    expect(t.win().win.isVisible()).toBe(true);
    finish();
    await flush();
    t.clock.advance(200);
    expect(t.win().win.isVisible()).toBe(false);
  });

  it('a show that arrives during the save keeps the pill', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    t.win().drag({ x: 700, y: 20, width: 80, height: 256 });
    t.win().endDrag();
    t.clock.advance(400);
    let finish: () => void = () => undefined;
    t.store.save.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    t.controller.setMainWindowActive(true);
    await flush();
    t.controller.setMainWindowActive(false);
    finish();
    await flush();
    t.clock.advance(1000);
    expect(t.win().win.isVisible()).toBe(true);
  });

  it('does not save a dock the user never changed (a failed load must not overwrite the file)', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.setMainWindowActive(true);
    await flush();
    expect(t.store.save).not.toHaveBeenCalled();
  });

  it('a save that throws is logged and the pill still hides', async () => {
    const t = setup();
    await startRecording(t);
    t.win().drag({ x: 700, y: 20, width: 80, height: 256 });
    t.win().endDrag();
    t.store.save.mockRejectedValue(new Error('disk full'));
    t.controller.setMainWindowActive(true);
    await flush();
    expect(t.win().win.isVisible()).toBe(false);
    expect(t.warn).toHaveBeenCalled();
  });
});

describe('drag and snap', () => {
  it('collapses an open panel when the drag starts, keeping the capsule under the cursor', async () => {
    const t = setup();
    await startRecording(t);
    t.controller.setExpanded(true);
    const expanded = t.win().win.getBounds();
    // The OS moves the expanded window 10 px left and 20 down.
    t.win().drag({ ...expanded, x: expanded.x - 10, y: expanded.y + 20 });
    expect(t.controller.state.expanded).toBe(false);
    expect(t.win().win.getBounds()).toEqual({
      ...RIGHT_DOCKED,
      x: RIGHT_DOCKED.x - 10,
      y: RIGHT_DOCKED.y + 20,
    });
    // The next OS move keeps following the cursor.
    t.win().drag({ ...expanded, x: expanded.x - 30, y: expanded.y + 40 });
    expect(t.win().win.getBounds()).toEqual({
      ...RIGHT_DOCKED,
      x: RIGHT_DOCKED.x - 30,
      y: RIGHT_DOCKED.y + 40,
    });
  });

  it('snaps to the nearest edge over 240 ms, then docks instantly', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    // Dropped near the left edge, a bit down.
    t.win().drag({ x: 100, y: 300, width: 80, height: 256 });
    t.win().endDrag();
    t.clock.advance(120);
    const mid = t.win().win.getBounds();
    expect(mid.x).toBeLessThan(100);
    expect(mid.x).toBeGreaterThan(8);
    t.clock.advance(200);
    const done = t.win().win.getBounds();
    expect(done.x).toBe(8); // Left edge: margin 16 minus the gutter
    expect(done.width).toBe(80);
    expect(t.controller.state.edge).toBe('Left');
  });

  it('snaps inside the work area of the display it was dropped on', async () => {
    const second: Rect = { x: 1536, y: 0, width: 1536, height: 816 };
    const t = setup({
      displays: [
        { id: 1, workArea: AREA, bounds: AREA },
        { id: 2, workArea: second, bounds: second },
      ],
    });
    await startRecording(t);
    t.win().drag({ x: 2900, y: 300, width: 80, height: 256 });
    t.win().endDrag();
    const done = t.win().win.getBounds();
    expect(t.controller.state.edge).toBe('Right');
    expect(done.x).toBeGreaterThanOrEqual(second.x);
    expect(done.x + done.width).toBeLessThanOrEqual(second.x + second.width);
    expect(done.x + done.width).toBeGreaterThan(AREA.width);
  });

  it('flips orientation at half way and crossfades the content', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    // Dropped near the top edge: vertical to horizontal.
    t.win().drag({ x: 700, y: 10, width: 80, height: 256 });
    t.win().endDrag();
    expect(t.controller.state.vertical).toBe(true);
    t.clock.advance(16);
    const early = t.win().states().at(-1);
    expect(early?.vertical).toBe(true);
    expect(early?.contentOpacity).toBeLessThan(1);
    t.clock.advance(120);
    expect(t.win().states().at(-1)?.vertical).toBe(false);
    t.clock.advance(300);
    expect(t.win().states().at(-1)).toMatchObject({
      vertical: false,
      contentOpacity: 1,
      edge: 'Top',
    });
    expect(t.win().win.getBounds()).toMatchObject({ width: 288, height: 80 });
  });

  it('with animations off the snap ends at once', async () => {
    const t = setup({ animations: false });
    await startRecording(t);
    t.win().drag({ x: 700, y: 10, width: 80, height: 256 });
    t.win().endDrag();
    expect(t.win().win.getBounds()).toMatchObject({ y: 8, width: 288, height: 80 });
    expect(t.clock.pending).toBe(1); // only the save debounce
  });

  it('ignores a press during the entrance (bug 18) and during a snap', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    expect(t.win().drag({ x: 1300, y: 300, width: 80, height: 256 })).toBe(true);
    t.clock.advance(400);
    t.win().drag({ x: 700, y: 10, width: 80, height: 256 });
    t.win().endDrag();
    expect(t.win().drag({ x: 600, y: 200, width: 288, height: 80 })).toBe(true);
    t.clock.advance(300);
    expect(t.win().drag({ x: 600, y: 200, width: 288, height: 80 })).toBe(false);
  });

  it('a click without a drag does not snap or save', async () => {
    const t = setup();
    await startRecording(t);
    const calls = t.win().boundsLog.length;
    t.win().endDrag();
    t.clock.advance(2000);
    expect(t.win().boundsLog).toHaveLength(calls);
    expect(t.store.save).not.toHaveBeenCalled();
  });

  it('is blocked while the pill is leaving', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.clock.advance(400);
    t.controller.setMainWindowActive(true);
    await flush();
    expect(t.win().drag({ x: 1300, y: 300, width: 80, height: 256 })).toBe(true);
  });
});

describe('re-dock on system changes', () => {
  it('re-docks once, deferred, when the OS moved the window by more than 2 px', async () => {
    const t = setup();
    await startRecording(t);
    const calls = t.win().boundsLog.length;
    t.win().setBounds({ ...RIGHT_DOCKED, x: RIGHT_DOCKED.x - 3 });
    t.displayChanged();
    t.displayChanged();
    expect(t.win().boundsLog).toHaveLength(calls); // deferred
    t.clock.advance(1);
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
    expect(t.win().boundsLog).toHaveLength(calls + 1);
  });

  it('re-docks after the OS moves or resizes the window with no display event', async () => {
    const t = setup();
    await startRecording(t);
    t.win().osChanged({ ...RIGHT_DOCKED, x: RIGHT_DOCKED.x - 40 });
    t.clock.advance(1);
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
    t.win().osChanged({ ...RIGHT_DOCKED, height: RIGHT_DOCKED.height + 30 });
    t.clock.advance(1);
    expect(t.win().win.getBounds()).toEqual(RIGHT_DOCKED);
  });

  it('ignores a change event that leaves the window where it should be', async () => {
    const t = setup();
    await startRecording(t);
    const calls = t.win().boundsLog.length;
    t.win().osChanged(RIGHT_DOCKED);
    t.clock.advance(10);
    expect(t.win().boundsLog).toHaveLength(calls);
  });

  it('ignores a difference of 2 px or less', async () => {
    const t = setup();
    await startRecording(t);
    const calls = t.win().boundsLog.length;
    t.win().setBounds({ ...RIGHT_DOCKED, x: RIGHT_DOCKED.x - 2, height: RIGHT_DOCKED.height + 2 });
    t.displayChanged();
    t.clock.advance(10);
    expect(t.win().boundsLog).toHaveLength(calls);
  });

  it('is ignored during a drag and during a tween, and when the pill is hidden', async () => {
    const t = setup({ animations: true });
    await startRecording(t);
    t.win().setBounds({ ...RIGHT_DOCKED, x: 0 });
    t.displayChanged(); // entering
    t.clock.advance(1);
    expect(t.win().win.getBounds().x).toBe(0);
    t.clock.advance(400);
    t.win().drag({ x: 1300, y: 300, width: 80, height: 256 });
    t.displayChanged(); // dragging
    t.clock.advance(1);
    expect(t.win().win.getBounds().x).toBe(1300);
    t.win().endDrag();
    t.clock.advance(1000);
    t.controller.setMainWindowActive(true);
    await flush();
    t.clock.advance(1000);
    t.win().setBounds({ x: 0, y: 0, width: 80, height: 256 });
    t.displayChanged(); // hidden
    t.clock.advance(10);
    expect(t.win().win.getBounds().x).toBe(0);
  });
});
