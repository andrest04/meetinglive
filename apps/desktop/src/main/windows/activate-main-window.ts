/** The slice of BrowserWindow the activation needs. */
export interface ActivatableWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  show(): void;
  restore(): void;
  focus(): void;
}

/**
 * The one way to bring the main window to the user: restore it if minimized, show it if hidden,
 * then focus it. Used by a second launch, the tray, the Start button of the call popup and the
 * close gate, so none of them can forget the minimized case (bug 9). Returns false when there is
 * no window to activate.
 */
export function activateMainWindow(window: ActivatableWindow | null | undefined): boolean {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
  return true;
}
