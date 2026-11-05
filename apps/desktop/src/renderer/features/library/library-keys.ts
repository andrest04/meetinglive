import type { KeyLike } from '../../app/shortcuts';

/** What a key does on a focused row. The chords live in the app's shortcut table. */
export type GridKeyAction = 'open' | 'toggle' | 'rename' | 'delete' | 'deletePermanently' | 'clear';

export function gridKeyAction(event: KeyLike): GridKeyAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.shiftKey) return event.key === 'Delete' ? 'deletePermanently' : null;
  switch (event.key) {
    case 'Enter':
      return 'open';
    case ' ':
      return 'toggle';
    case 'F2':
      return 'rename';
    case 'Delete':
      return 'delete';
    case 'Escape':
      return 'clear';
    default:
      return null;
  }
}
