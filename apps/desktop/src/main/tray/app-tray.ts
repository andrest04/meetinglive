import { buildTrayModel, type TrayActionId } from './tray-model';

/** The slice of Electron's Tray the app uses. */
export interface TrayLike {
  setToolTip(tooltip: string): void;
  setContextMenu(menu: unknown): void;
  on(event: 'click' | 'double-click', listener: () => void): unknown;
  destroy(): void;
  isDestroyed(): boolean;
}

export interface AppTrayDeps {
  readonly createTray: () => TrayLike;
  /** Builds a native menu from the model, calling `run` with the chosen action. */
  readonly buildMenu: (
    items: readonly { readonly id: TrayActionId; readonly label: string }[],
    run: (id: TrayActionId) => void,
  ) => unknown;
  readonly t: (key: string) => string;
  /** Show, restore and focus the main window (the activation helper). */
  readonly open: () => void;
  /** Quit through the exit gate; it must never bypass it. */
  readonly quit: () => void;
}

/**
 * The tray icon. The window still closes the app (items 11 and 170), so the tray lives and dies
 * with the window; its use is to bring the window back after the recording start minimized it.
 */
export class AppTray {
  private readonly tray: TrayLike;
  private recording = false;

  constructor(private readonly deps: AppTrayDeps) {
    this.tray = deps.createTray();
    this.tray.on('click', deps.open);
    this.tray.on('double-click', deps.open);
    this.render();
  }

  setRecording(isRecording: boolean): void {
    if (isRecording === this.recording) return;
    this.recording = isRecording;
    this.render();
  }

  destroy(): void {
    if (!this.tray.isDestroyed()) this.tray.destroy();
  }

  private render(): void {
    if (this.tray.isDestroyed()) return;
    const model = buildTrayModel({ isRecording: this.recording, t: this.deps.t });
    this.tray.setToolTip(model.tooltip);
    this.tray.setContextMenu(
      this.deps.buildMenu(model.items, (id) => {
        if (id === 'open') this.deps.open();
        else this.deps.quit();
      }),
    );
  }
}
