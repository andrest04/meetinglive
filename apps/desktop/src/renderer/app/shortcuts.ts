/**
 * The one shortcut table (items 138 and 139, _gaps.md section 3). Every chord the app owns is
 * listed here with the region it belongs to; the hooks and components below read it instead of
 * comparing keys themselves, and tooltips take the chord from it. No chord is global to the OS,
 * and Ctrl+Enter exists in two regions that never see each other's events (the live ask box and
 * the chat composer), because each handler is attached to its own element.
 *
 * The detected question card (live question detection, returned 2026-11-05) answers on the same
 * Ctrl+Enter chord as the live ask box (`isAnswerQuestionShortcut`). It is window-wide, so it
 * yields to the two text boxes above: their handlers mark the event handled, and a key pressed in
 * any text field is left to that field.
 */
export type ShortcutId =
  'stop' | 'pause' | 'discard' | 'liveAsk' | 'chatSend' | 'librarySearch' | 'librarySelectAll';
export type ShortcutScope = 'record' | 'liveAsk' | 'chatComposer' | 'library' | 'libraryGrid';

export interface ShortcutDef {
  readonly scope: ShortcutScope;
  readonly ctrl: true;
  readonly shift: boolean;
  /** `KeyboardEvent.key`, compared case-insensitively. */
  readonly key: string;
  /** The key caps, in the order they are pressed. */
  readonly keys: readonly string[];
}

export const SHORTCUTS: Readonly<Record<ShortcutId, ShortcutDef>> = {
  stop: { scope: 'record', ctrl: true, shift: false, key: 'r', keys: ['Ctrl', 'R'] },
  pause: { scope: 'record', ctrl: true, shift: false, key: 'p', keys: ['Ctrl', 'P'] },
  discard: { scope: 'record', ctrl: true, shift: true, key: 'd', keys: ['Ctrl', 'Shift', 'D'] },
  liveAsk: { scope: 'liveAsk', ctrl: true, shift: false, key: 'enter', keys: ['Ctrl', 'Enter'] },
  chatSend: {
    scope: 'chatComposer',
    ctrl: true,
    shift: false,
    key: 'enter',
    keys: ['Ctrl', 'Enter'],
  },
  librarySearch: { scope: 'library', ctrl: true, shift: false, key: 'f', keys: ['Ctrl', 'F'] },
  // Only on the grid: in a text field Ctrl+A keeps selecting the text.
  librarySelectAll: {
    scope: 'libraryGrid',
    ctrl: true,
    shift: false,
    key: 'a',
    keys: ['Ctrl', 'A'],
  },
};

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** "Ctrl+Shift+D": the chord as one string, for text and accessible names. */
export const chordLabel = (id: ShortcutId): string => SHORTCUTS[id].keys.join('+');

function matches(id: ShortcutId, event: KeyLike): boolean {
  const def = SHORTCUTS[id];
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.shiftKey === def.shift &&
    event.key.toLowerCase() === def.key
  );
}

export type RecordShortcut = Extract<ShortcutId, 'stop' | 'pause' | 'discard'>;
const RECORD_IDS: readonly RecordShortcut[] = ['stop', 'pause', 'discard'];

/** Ctrl+R stops or starts, Ctrl+P pauses or resumes, Ctrl+Shift+D discards (spec 2.6). */
export function matchRecordShortcut(event: KeyLike): RecordShortcut | null {
  return RECORD_IDS.find((id) => matches(id, event)) ?? null;
}

export type LibraryShortcut = Extract<ShortcutId, 'librarySearch' | 'librarySelectAll'>;
const LIBRARY_IDS: readonly LibraryShortcut[] = ['librarySearch', 'librarySelectAll'];

/** Ctrl+F goes to the search, Ctrl+A checks every row of the list. */
export function matchLibraryShortcut(event: KeyLike): LibraryShortcut | null {
  return LIBRARY_IDS.find((id) => matches(id, event)) ?? null;
}

/** True for Ctrl+Enter, the chord of the live ask box and of the chat composer. */
export const isCtrlEnter = (event: KeyLike): boolean => matches('liveAsk', event);

/** Ctrl+Enter outside any text field, not already handled: answers the detected question. */
export function isAnswerQuestionShortcut(
  event: KeyLike & { readonly defaultPrevented: boolean; readonly target: EventTarget | null },
): boolean {
  if (event.defaultPrevented || !matches('liveAsk', event)) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  if (target.isContentEditable) return false;
  return !target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

/** What Enter and Ctrl+Enter do in the chat composer (spec 2.3, S1). */
export type ComposerIntent = 'send' | 'newline' | 'ignore' | 'swallow';

export interface ComposerKeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly isComposing: boolean;
  readonly draft: string;
  readonly sending: boolean;
}

/**
 * Enter sends, Shift+Enter inserts a line, Ctrl+Enter sends. Enter on an empty draft or while an
 * answer runs does nothing and inserts no line (`swallow`); Enter during IME composition is left
 * to the IME (`ignore`).
 */
export function composerIntent(input: ComposerKeyInput): ComposerIntent {
  if (input.key !== 'Enter') return 'ignore';
  if (input.isComposing) return 'ignore';
  if (input.shiftKey && !input.ctrlKey) return 'newline';
  if (input.sending || input.draft.trim() === '') return 'swallow';
  return 'send';
}
