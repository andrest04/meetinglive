import { pillHint, pillStateChanged, type PillStateDto } from '@vozella/contracts';
import {
  capsuleSizePx,
  clamp,
  decideRecordingHandoff,
  DEFAULT_ALONG,
  DEFAULT_EDGE,
  easeInCubic,
  easeOutQuint,
  expandedBounds,
  gapPx,
  isVertical,
  lerpRect,
  marginPx,
  offscreenRect,
  panelRect,
  panelSizePx,
  planSnap,
  positionFor,
  shouldRedock,
  shouldShowRecordingPill,
  snapFrame,
  STARTED_HINT_DURATION_MS,
  TIMINGS,
  tweenProgress,
  type DockEdge,
  type DockState,
  type Point,
  type Rect,
} from '@vozella/core';
import type { PillMoveEvent, PillWindowPort } from '../windows/pill-window';

/**
 * Decision (DIP versus physical): Electron window bounds, `screen` work areas and display bounds
 * are all device independent, and the OS converts to physical pixels per monitor. The geometry of
 * the WinUI window ran in physical pixels with a fresh scale; here every rectangle stays in DIP
 * and the core geometry runs with scale 1. The sizes are the DIP constants (64, 240, 272, 16, 8)
 * and nothing is converted twice. At a fractional scale the OS rounds the final position to a
 * physical pixel once, which is the one rounding the WinUI app also did.
 */
const SCALE = 1;

/**
 * Transparent margin around the capsule inside the window, in DIP (the gutter the window spike
 * proved, so a shadow is not clipped). Decision on hit testing: the gutter is part of the window
 * and takes input like the rest of it. The pill is not click-through anywhere (spec section 5),
 * so a stray click next to the capsule lands on the pill and not on the app underneath, and
 * `setIgnoreMouseEvents` is never used.
 */
export const GUTTER_DIP = 8;

export interface PillClock {
  now(): number;
  setTimeout(run: () => void, ms: number): () => void;
  setInterval(run: () => void, ms: number): () => void;
}

export interface PillDisplay {
  readonly id: number;
  readonly workArea: Rect;
  readonly bounds: Rect;
}

export interface PillScreenPort {
  primaryWorkArea(): Rect;
  /** The display holding the point, or the nearest one. */
  displayAt(point: Point): PillDisplay;
  allDisplays(): readonly PillDisplay[];
  /** Display removed or its metrics changed. Returns the unsubscribe. */
  onDisplayChanged(listener: () => void): () => void;
}

export interface PillDockStorePort {
  load(): Promise<DockState>;
  save(state: DockState): Promise<void>;
}

export interface PillHandoffPort {
  /** The "meeting detected" popup goes away when a take starts. */
  dismissMeetingPopup(): void;
  /** True when the main window was minimized; false when it could not be. */
  minimizeMainWindow(): boolean;
}

export interface PillControllerDeps {
  readonly createWindow: () => PillWindowPort;
  readonly screen: PillScreenPort;
  readonly clock: PillClock;
  readonly dock: PillDockStorePort;
  /** The OS animation setting, read each time it matters. */
  readonly animationsEnabled: () => boolean;
  /** Lets the IPC guard trust the new window's page. */
  readonly trustSender: (webContentsId: number) => void;
  readonly handoff: PillHandoffPort;
  readonly logger: { warn(message: string, context?: Record<string, unknown>): void };
}

interface Layout {
  /** The window rectangle (capsule or capsule plus panel, outset by the gutter). */
  readonly window: Rect;
  /** Capsule inside the window. */
  readonly capsule: Rect;
  readonly panel: Rect | null;
}

const outset = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + 2 * by,
  height: rect.height + 2 * by,
});

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A collapsed window is the capsule and its gutter. */
function collapsedLayout(window: Rect): Layout {
  return {
    window,
    capsule: {
      x: GUTTER_DIP,
      y: GUTTER_DIP,
      width: window.width - 2 * GUTTER_DIP,
      height: window.height - 2 * GUTTER_DIP,
    },
    panel: null,
  };
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The live copilot pill: when it shows, where it docks, how it moves. Specs 2.1, 2.4, 2.5, 2.7.
 *
 * Main owns every decision; the page only draws what `pill.state` says. Nothing here touches
 * Electron: the window, the screen, the clock and the dock store are ports, so the lifecycle is
 * tested with fakes.
 */
export class PillController {
  private window: PillWindowPort | null = null;
  private unsubscribeScreen: (() => void) | null = null;

  // The rule inputs (spec 2.1). `mainWindowActive` starts true.
  private isRecording = false;
  private mainWindowActive = true;
  private handingOff = false;
  /** The latest requested visibility; a show or hide that finds it changed gives up. */
  private wantVisible = false;

  // Dock.
  private edge: DockEdge = DEFAULT_EDGE;
  private along = DEFAULT_ALONG;
  private expanded = false;
  private verticalLayout = true;
  private placed = false;
  private dockLoaded = false;
  private dockLoad: Promise<void> | null = null;
  /** The user chose a dock (a snap): a late load must not overwrite it, and only then is it saved. */
  private dockTouched = false;
  private layout: Layout = collapsedLayout({ x: 0, y: 0, width: 80, height: 256 });
  private dockedWindow: Rect = this.layout.window;
  private expectedRect: Rect | null = null;

  // Motion.
  private entering = false;
  private exiting = false;
  private snapping = false;
  private dragging = false;
  private redockQueued = false;
  private opacity = 1;
  private contentOpacity = 1;
  private cancelTween: (() => void) | null = null;
  /** While a drag collapses the panel, the OS still proposes rectangles of the old window. */
  private dragShift: { dx: number; dy: number } | null = null;
  private cancelSave: (() => void) | null = null;

  // Started hint.
  private hintPending = false;
  private hintShowing = false;
  private cancelHintTimer: (() => void) | null = null;

  constructor(private readonly deps: PillControllerDeps) {
    this.unsubscribeScreen = deps.screen.onDisplayChanged(() => {
      this.onDisplayChanged();
    });
  }

  // ---- inputs -------------------------------------------------------------------------------

  /** Main window focus, blur, minimize and restore. */
  setMainWindowActive(active: boolean): void {
    this.mainWindowActive = active;
    this.update();
  }

  /**
   * Every `recording.state` change. The false to true transition is the start handoff; pause,
   * resume, stop, discard and import never are.
   */
  onRecordingState(isRecording: boolean): void {
    const was = this.isRecording;
    this.isRecording = isRecording;
    const decision = decideRecordingHandoff(was, isRecording);
    if (decision.minimizeMainWindow) this.startHandoff(decision.showStartedHint);
    else this.update();
  }

  /** The chat button. Instant both ways; the page animates the panel itself. */
  setExpanded(expanded: boolean): PillStateDto {
    if (expanded === this.expanded) return this.state;
    const win = this.live();
    if (!win?.isVisible()) {
      // Hidden: the flag is kept and the next show docks with it.
      this.expanded = expanded;
      return this.state;
    }
    // A press during the entrance, exit, snap or drag is ignored like the drag is (bug 18).
    if (this.entering || this.exiting || this.snapping || this.dragging) return this.state;
    this.expanded = expanded;
    this.dock();
    return this.state;
  }

  get state(): PillStateDto {
    const win = this.live();
    return {
      visible: win?.isVisible() ?? false,
      expanded: this.expanded,
      edge: this.edge,
      vertical: this.verticalLayout,
      animationsEnabled: this.deps.animationsEnabled(),
      opacity: this.opacity,
      contentOpacity: this.contentOpacity,
      window: { width: this.layout.window.width, height: this.layout.window.height },
      capsule: this.layout.capsule,
      panel: this.layout.panel,
    };
  }

  /** The main window closed. */
  dispose(): void {
    this.wantVisible = false;
    this.stopTween();
    this.cancelHint();
    this.cancelSave?.();
    this.cancelSave = null;
    this.unsubscribeScreen?.();
    this.unsubscribeScreen = null;
    const win = this.live();
    this.window = null;
    win?.close();
  }

  // ---- visibility ---------------------------------------------------------------------------

  private startHandoff(showHint: boolean): void {
    try {
      this.deps.handoff.dismissMeetingPopup();
    } catch (error) {
      this.deps.logger.warn('pill handoff: popup dismiss failed', { error: errorText(error) });
    }
    let minimized = false;
    try {
      minimized = this.deps.handoff.minimizeMainWindow();
    } catch (error) {
      this.deps.logger.warn('pill handoff: minimize failed', { error: errorText(error) });
    }
    // Set after the minimize, so a focus event it caused cannot leave the flag true.
    if (minimized) this.mainWindowActive = false;
    this.handingOff = true;
    try {
      this.update();
      if (showHint) this.requestStartedHint();
    } finally {
      this.handingOff = false;
    }
    // Bug 14: without a minimize nothing would re-evaluate, and the pill would sit over the
    // active main window. Ask again now that the handoff is over.
    if (!minimized) this.update();
  }

  private update(): void {
    const show = shouldShowRecordingPill(this.isRecording, this.mainWindowActive, this.handingOff);
    this.setVisible(show, !this.isRecording).catch((error: unknown) => {
      // Bug 13: the call is fire-and-forget, so nothing else would ever see the failure.
      this.deps.logger.warn('pill visibility failed', { error: errorText(error) });
    });
  }

  /** Read through a method: a show or hide that awaited must see what changed meanwhile. */
  private isWanted(): boolean {
    return this.wantVisible;
  }

  private setVisible(visible: boolean, collapse: boolean): Promise<void> {
    return visible ? this.show() : this.hide(collapse);
  }

  private async show(): Promise<void> {
    this.wantVisible = true;
    await this.ensureDockLoaded();
    if (!this.isWanted()) return;
    const win = this.ensureWindow();
    await win.whenLoaded();
    if (!this.isWanted() || win.isDestroyed()) return;
    // Already on screen and not leaving: nothing to do (no re-dock, no animation).
    if (win.isVisible() && !this.exiting) return;

    const resumedFrom = this.exiting ? win.getBounds() : null;
    const resumedOpacity = this.opacity;
    this.completeSnap();
    this.stopTween();
    this.exiting = false;
    this.entering = false;
    this.opacity = 1;
    this.contentOpacity = 1;
    this.dock();
    this.playEntrance(resumedFrom, resumedOpacity);
  }

  private async hide(collapse: boolean): Promise<void> {
    this.wantVisible = false;
    this.cancelHint();
    if (collapse && this.expanded) {
      this.expanded = false;
      const win = this.live();
      if (win?.isVisible()) this.dock();
    }
    const win = this.live();
    if (!win || !win.isVisible() || this.exiting) return;
    this.completeSnap();
    this.cancelSave?.();
    this.cancelSave = null;
    await this.saveDock();
    if (this.isWanted() || win.isDestroyed()) return;
    this.playExit(win);
  }

  private playEntrance(resumedFrom: Rect | null, resumedOpacity: number): void {
    const win = this.live();
    if (!win) return;
    const docked = this.dockedWindow;
    if (!this.deps.animationsEnabled()) {
      this.opacity = 1;
      if (!win.isVisible()) win.showInactive();
      this.push();
      this.maybeRunHint();
      return;
    }
    this.entering = true;
    const startOpacity = resumedFrom ? resumedOpacity : 0;
    const from = resumedFrom ?? this.slideRect(docked);
    this.opacity = startOpacity;
    win.setBounds(from);
    if (!win.isVisible()) win.showInactive();
    this.push();
    this.runTween(
      TIMINGS.entranceMs,
      (t) => {
        const eased = easeOutQuint(t);
        win.setBounds(lerpRect(from, docked, eased));
        this.opacity = startOpacity + (1 - startOpacity) * eased;
        this.push();
      },
      () => {
        this.opacity = 1;
        this.entering = false;
        this.expectedRect = win.getBounds();
        this.push();
        this.maybeRunHint();
      },
    );
  }

  private playExit(win: PillWindowPort): void {
    const docked = this.dockedWindow;
    const finish = (): void => {
      this.exiting = false;
      if (this.wantVisible) return;
      win.hide();
      this.opacity = 1;
      this.contentOpacity = 1;
      // The hidden window goes back to its docked place, so the next show finds the right monitor.
      win.setBounds(docked);
      this.expectedRect = win.getBounds();
      this.push();
    };
    if (!this.deps.animationsEnabled()) {
      finish();
      return;
    }
    this.exiting = true;
    const from = win.getBounds();
    const to = this.slideRect(from);
    this.runTween(
      TIMINGS.exitMs,
      (t) => {
        const eased = easeInCubic(t);
        win.setBounds(lerpRect(from, to, eased));
        this.opacity = 1 - eased;
        this.push();
      },
      finish,
    );
  }

  /**
   * Where the slide starts and ends: the docked rectangle pushed past its edge. Bug 11: when that
   * would land on a neighbouring monitor, the slide stops at the edge of this display and the
   * fade does the rest.
   */
  private slideRect(docked: Rect): Rect {
    const target = offscreenRect(this.edge, docked, marginPx(SCALE));
    const here = this.deps.screen.displayAt(this.centerOf(docked));
    const crossesIntoNeighbour = this.deps.screen
      .allDisplays()
      .some((d) => d.id !== here.id && intersects(d.bounds, target));
    if (!crossesIntoNeighbour) return target;
    const kept = clamp(target.x, target.y, target.width, target.height, here.bounds);
    return { ...target, x: kept.x, y: kept.y };
  }

  // ---- docking ------------------------------------------------------------------------------

  private ensureWindow(): PillWindowPort {
    const existing = this.live();
    if (existing) return existing;
    const win = this.deps.createWindow();
    this.deps.trustSender(win.webContentsId);
    win.onWillMove((event) => {
      this.onWillMove(event);
    });
    win.onMoved(() => {
      this.onMoved();
    });
    win.onClosed(() => {
      if (this.window !== win) return;
      this.window = null;
      this.placed = false;
      this.entering = false;
      this.exiting = false;
      this.snapping = false;
      this.dragging = false;
      this.dragShift = null;
      this.stopTween();
      this.cancelHint();
    });
    this.window = win;
    return win;
  }

  private live(): PillWindowPort | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  /**
   * Instant dock (also the recovery path): fresh work area, one `setBounds` with the full size.
   * The first time, the window is moved to the work-area origin first, while hidden, so the
   * display scale in force is the target monitor's (spec 2.4).
   */
  private dock(): Rect {
    const win = this.ensureWindow();
    let area: Rect;
    if (this.placed) {
      area = this.deps.screen.displayAt(this.centerOf(win.getBounds())).workArea;
    } else {
      area = this.deps.screen.primaryWorkArea();
      win.setBounds({ ...win.getBounds(), x: area.x, y: area.y });
      this.placed = true;
    }
    this.verticalLayout = isVertical(this.edge);
    this.layout = this.computeLayout(area);
    win.setBounds(this.layout.window);
    // The OS may refuse the size it was given: what it granted is what counts from here.
    const granted = win.getBounds();
    this.dockedWindow = granted;
    this.expectedRect = granted;
    this.layout = { ...this.layout, window: granted };
    this.push();
    return granted;
  }

  private computeLayout(area: Rect): Layout {
    const size = capsuleSizePx(this.edge, SCALE);
    const origin = positionFor(
      this.edge,
      this.along,
      size.width,
      size.height,
      area,
      marginPx(SCALE),
    );
    const capsule: Rect = { x: origin.x, y: origin.y, width: size.width, height: size.height };
    if (!this.expanded) {
      return {
        window: outset(capsule, GUTTER_DIP),
        capsule: { x: GUTTER_DIP, y: GUTTER_DIP, width: size.width, height: size.height },
        panel: null,
      };
    }
    const panel = panelSizePx(SCALE);
    const logical = expandedBounds(
      this.edge,
      capsule,
      panel.width,
      panel.height,
      gapPx(SCALE),
      area,
    );
    const window = outset(logical, GUTTER_DIP);
    const inside = panelRect(this.edge, capsule, logical, SCALE);
    return {
      window,
      capsule: {
        x: capsule.x - window.x,
        y: capsule.y - window.y,
        width: capsule.width,
        height: capsule.height,
      },
      panel: { ...inside, x: inside.x + GUTTER_DIP, y: inside.y + GUTTER_DIP },
    };
  }

  private centerOf(rect: Rect): Point {
    return { x: rect.x + Math.trunc(rect.width / 2), y: rect.y + Math.trunc(rect.height / 2) };
  }

  // ---- dock persistence ---------------------------------------------------------------------

  /** Read once per process. A failure keeps the defaults and is retried at the next show. */
  private async ensureDockLoaded(): Promise<void> {
    if (this.dockLoaded) return;
    if (!this.dockLoad) {
      const load = this.runDockLoad();
      this.dockLoad = load;
      void load.finally(() => {
        if (this.dockLoad === load) this.dockLoad = null;
      });
    }
    await this.dockLoad;
  }

  private async runDockLoad(): Promise<void> {
    try {
      const stored = await this.deps.dock.load();
      this.dockLoaded = true;
      if (!this.dockTouched) {
        this.edge = stored.edge;
        this.along = stored.along;
      }
    } catch (error) {
      this.deps.logger.warn('pill dock load failed; using the defaults', {
        error: errorText(error),
      });
    }
  }

  private async saveDock(): Promise<void> {
    // Only a dock the user chose is written. After a failed load the defaults are not the file.
    if (!this.dockTouched) return;
    try {
      await this.deps.dock.save({ edge: this.edge, along: this.along });
    } catch (error) {
      this.deps.logger.warn('pill dock save failed', { error: errorText(error) });
    }
  }

  private scheduleSave(): void {
    this.cancelSave?.();
    this.cancelSave = this.deps.clock.setTimeout(() => {
      this.cancelSave = null;
      void this.saveDock();
    }, TIMINGS.saveDebounceMs);
  }

  // ---- drag and snap ------------------------------------------------------------------------

  /**
   * The OS move loop. Decision: the 4 DIP drag threshold is the OS drag threshold, because the
   * drag is the app-region drag of the page, so `screen.getCursorScreenPoint` is not needed: the
   * proposed rectangle already follows the cursor delta from the origin captured at drag start.
   */
  private onWillMove(event: PillMoveEvent): void {
    const win = this.live();
    if (!win) return;
    // Presses during the entrance, the exit and a snap are ignored (bug 18 keeps the rule, spec 2.7).
    if (this.entering || this.exiting || this.snapping || !win.isVisible()) {
      event.preventDefault();
      return;
    }
    if (!this.dragging) {
      this.dragging = true;
      this.cancelHint();
      if (this.expanded) {
        // Close the panel at once. The capsule stays where it is, so the window becomes the
        // capsule rectangle; the OS keeps proposing rectangles of the old window, so every move
        // from here is shifted by the same offset.
        const before = win.getBounds();
        this.expanded = false;
        const after = this.dock();
        this.dragShift = { dx: after.x - before.x, dy: after.y - before.y };
      }
    }
    if (this.dragShift) {
      event.preventDefault();
      win.setBounds({
        x: event.newBounds.x + this.dragShift.dx,
        y: event.newBounds.y + this.dragShift.dy,
        width: this.layout.window.width,
        height: this.layout.window.height,
      });
    }
  }

  private onMoved(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.dragShift = null;
    const win = this.live();
    if (!win) return;
    this.startSnap(win);
  }

  /** Spec 2.7 `SnapToNearestEdge`: nearest edge by the window center, then a 240 ms tween. */
  private startSnap(win: PillWindowPort): void {
    const from = win.getBounds();
    const area = this.deps.screen.displayAt(this.centerOf(from)).workArea;
    const plan = planSnap({ fromEdge: this.edge, window: from, area, scale: SCALE });
    this.edge = plan.edge;
    this.along = plan.along;
    this.dockTouched = true;
    this.snapping = true;
    // The plan's target is the capsule; the window also carries the gutter.
    const target = outset(plan.target, GUTTER_DIP);
    const framed = { ...plan, target };
    this.runTween(
      TIMINGS.snapMs,
      (t) => {
        // `snapFrame` wants elapsed time; the progress is the same number over the same duration.
        const frame = snapFrame(framed, from, t * TIMINGS.snapMs);
        win.setBounds(frame.rect);
        if (frame.switchOrientation) this.verticalLayout = isVertical(plan.edge);
        this.contentOpacity = frame.opacity;
        this.layout = collapsedLayout(frame.rect);
        this.push();
      },
      () => {
        this.completeSnap();
        this.scheduleSave();
      },
    );
  }

  /** Opacity 1 and an instant dock; used when the snap tween ends and when something cuts it short. */
  private completeSnap(): void {
    if (!this.snapping) return;
    this.snapping = false;
    this.stopTween();
    this.contentOpacity = 1;
    this.dock();
  }

  private onDisplayChanged(): void {
    const win = this.live();
    if (!win?.isVisible()) return;
    if (this.dragging || this.entering || this.exiting || this.snapping || this.redockQueued) {
      return;
    }
    if (!this.expectedRect || !shouldRedock(this.expectedRect, win.getBounds())) return;
    this.redockQueued = true;
    this.deps.clock.setTimeout(() => {
      this.redockQueued = false;
      const current = this.live();
      if (!current?.isVisible()) return;
      if (this.dragging || this.entering || this.exiting || this.snapping) return;
      if (!this.expectedRect || !shouldRedock(this.expectedRect, current.getBounds())) return;
      try {
        this.dock();
      } catch (error) {
        this.deps.logger.warn('pill re-dock failed', { error: errorText(error) });
      }
    }, 0);
  }

  // ---- tween --------------------------------------------------------------------------------

  /** One tween at a time. With the OS animations off the end state is applied at once. */
  private runTween(durationMs: number, onProgress: (t: number) => void, onDone: () => void): void {
    this.stopTween();
    if (!this.deps.animationsEnabled()) {
      onProgress(1);
      onDone();
      return;
    }
    const clock = this.deps.clock;
    const startedAt = clock.now();
    let cancel: (() => void) | null = null;
    cancel = clock.setInterval(() => {
      const t = tweenProgress(clock.now() - startedAt, durationMs);
      onProgress(t);
      if (t >= 1) {
        // Only this tween's own end: a newer tween replaced `cancelTween` already.
        if (this.cancelTween === cancel) this.stopTween();
        onDone();
      }
    }, TIMINGS.tickMs);
    this.cancelTween = cancel;
  }

  private stopTween(): void {
    this.cancelTween?.();
    this.cancelTween = null;
  }

  // ---- started hint -------------------------------------------------------------------------

  private requestStartedHint(): void {
    this.hintPending = true;
    this.maybeRunHint();
  }

  /** Pending until the pill is on screen and not entering or leaving. */
  private maybeRunHint(): void {
    const win = this.live();
    if (!this.hintPending || !win || !win.isVisible() || this.entering || this.exiting) return;
    this.hintPending = false;
    this.hintShowing = true;
    win.send(pillHint, {
      show: true,
      durationMs: STARTED_HINT_DURATION_MS,
      edge: this.edge,
      pulse: this.deps.animationsEnabled(),
    });
    this.cancelHintTimer?.();
    this.cancelHintTimer = this.deps.clock.setTimeout(() => {
      this.cancelHintTimer = null;
      this.closeHint();
    }, STARTED_HINT_DURATION_MS);
  }

  /** Hide, drag start and window close. */
  private cancelHint(): void {
    this.hintPending = false;
    this.cancelHintTimer?.();
    this.cancelHintTimer = null;
    this.closeHint();
  }

  private closeHint(): void {
    if (!this.hintShowing) return;
    this.hintShowing = false;
    this.live()?.send(pillHint, {
      show: false,
      durationMs: STARTED_HINT_DURATION_MS,
      edge: this.edge,
      pulse: false,
    });
  }

  private push(): void {
    this.live()?.send(pillStateChanged, this.state);
  }
}
