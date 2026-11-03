export const COPY_FEEDBACK_MS = 2500;

/** Items 56 and 57: the text to put on the clipboard, or null when nothing should be copied. */
export function copyCommand(text: string | null | undefined): string | null {
  return text === null || text === undefined || text.trim() === '' ? null : text;
}

export interface TimerPort {
  setTimeout(task: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CopyFeedback {
  readonly visible: boolean;
  /** Shows the bar and restarts the 2.5 s timer (item 59). */
  show(): void;
  /** Manual dismiss (item 60). */
  dismiss(): void;
  subscribe(listener: (visible: boolean) => void): () => void;
}

export function createCopyFeedback(timers: TimerPort, durationMs = COPY_FEEDBACK_MS): CopyFeedback {
  let visible = false;
  let handle: unknown = null;
  const listeners = new Set<(visible: boolean) => void>();
  const set = (next: boolean): void => {
    if (visible === next) return;
    visible = next;
    for (const l of [...listeners]) l(next);
  };
  const clear = (): void => {
    if (handle !== null) timers.clearTimeout(handle);
    handle = null;
  };
  return {
    get visible() {
      return visible;
    },
    show() {
      clear();
      set(true);
      handle = timers.setTimeout(() => {
        handle = null;
        set(false);
      }, durationMs);
    },
    dismiss() {
      clear();
      set(false);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
