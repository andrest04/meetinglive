import { useEffect, useRef } from 'react';
import { matchRecordShortcut, type RecordShortcut } from '../../app/shortcuts';

export type { RecordShortcut };
/** Ctrl+R, Ctrl+P and Ctrl+Shift+D (spec 2.6); the chords live in app/shortcuts.ts. */
export const matchShortcut = matchRecordShortcut;

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
      const shortcut = matchRecordShortcut(event);
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
