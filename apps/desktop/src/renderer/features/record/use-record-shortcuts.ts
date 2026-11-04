import { useEffect, useRef } from 'react';

export type RecordShortcut = 'stop' | 'pause' | 'discard';

/** Ctrl+R stops, Ctrl+P pauses or resumes, Ctrl+Shift+D discards (spec 2.6). */
export function matchShortcut(event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): RecordShortcut | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'r' && !event.shiftKey) return 'stop';
  if (key === 'p' && !event.shiftKey) return 'pause';
  if (key === 'd' && event.shiftKey) return 'discard';
  return null;
}

export interface ShortcutAction {
  readonly enabled: boolean;
  readonly run: () => void;
}

export type RecordShortcutHandlers = Readonly<Record<RecordShortcut, ShortcutAction>>;

/**
 * The page-scoped accelerators, live while the recording controls are mounted (the Record page is
 * the only content of its window). As in the WinUI handlers, the event is marked handled before
 * the enabled check, so a disabled Stop still swallows Ctrl+R and the page never reloads.
 */
export function useRecordShortcuts(handlers: RecordShortcutHandlers | null): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const active = handlers !== null;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcut = matchShortcut(event);
      const current = latest.current;
      if (shortcut === null || current === null) return;
      event.preventDefault();
      event.stopPropagation();
      const action = current[shortcut];
      if (action.enabled) action.run();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active]);
}
