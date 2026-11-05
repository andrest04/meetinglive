import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  chordLabel,
  composerIntent,
  isCtrlEnter,
  matchLibraryShortcut,
  matchRecordShortcut,
  type KeyLike,
} from './shortcuts';

const key = (init: Partial<KeyLike> & { key: string }): KeyLike => ({
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...init,
});

describe('shortcut table (items 138, 139, _gaps section 3)', () => {
  it('lists every chord once, with its scope', () => {
    expect(
      Object.entries(SHORTCUTS).map(([id, s]) => [id, s.scope, chordLabel(id as never)]),
    ).toEqual([
      ['stop', 'record', 'Ctrl+R'],
      ['pause', 'record', 'Ctrl+P'],
      ['discard', 'record', 'Ctrl+Shift+D'],
      ['liveAsk', 'liveAsk', 'Ctrl+Enter'],
      ['chatSend', 'chatComposer', 'Ctrl+Enter'],
      ['librarySearch', 'library', 'Ctrl+F'],
      ['librarySelectAll', 'libraryGrid', 'Ctrl+A'],
    ]);
  });

  it('maps the library chords and nothing else', () => {
    expect(matchLibraryShortcut(key({ key: 'f', ctrlKey: true }))).toBe('librarySearch');
    expect(matchLibraryShortcut(key({ key: 'F', ctrlKey: true }))).toBe('librarySearch');
    expect(matchLibraryShortcut(key({ key: 'a', ctrlKey: true }))).toBe('librarySelectAll');
    expect(matchLibraryShortcut(key({ key: 'a' }))).toBeNull();
    expect(matchLibraryShortcut(key({ key: 'a', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchLibraryShortcut(key({ key: 'r', ctrlKey: true }))).toBeNull();
  });

  it('maps the record chords and nothing else', () => {
    expect(matchRecordShortcut(key({ key: 'r', ctrlKey: true }))).toBe('stop');
    expect(matchRecordShortcut(key({ key: 'R', ctrlKey: true }))).toBe('stop');
    expect(matchRecordShortcut(key({ key: 'p', ctrlKey: true }))).toBe('pause');
    expect(matchRecordShortcut(key({ key: 'D', ctrlKey: true, shiftKey: true }))).toBe('discard');
    expect(matchRecordShortcut(key({ key: 'd', ctrlKey: true }))).toBeNull();
    expect(matchRecordShortcut(key({ key: 'r', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchRecordShortcut(key({ key: 'r' }))).toBeNull();
    expect(matchRecordShortcut(key({ key: 'r', ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchRecordShortcut(key({ key: 'Enter', ctrlKey: true }))).toBeNull();
  });

  it('Ctrl+Enter is exactly Ctrl and Enter', () => {
    expect(isCtrlEnter(key({ key: 'Enter', ctrlKey: true }))).toBe(true);
    expect(isCtrlEnter(key({ key: 'Enter' }))).toBe(false);
    expect(isCtrlEnter(key({ key: 'Enter', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isCtrlEnter(key({ key: 'Enter', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isCtrlEnter(key({ key: 'r', ctrlKey: true }))).toBe(false);
  });
});

describe('composerIntent (item 123)', () => {
  const base = {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    isComposing: false,
    draft: 'hello',
    sending: false,
  };
  it('Enter and Ctrl+Enter send, Shift+Enter adds a line', () => {
    expect(composerIntent(base)).toBe('send');
    expect(composerIntent({ ...base, ctrlKey: true })).toBe('send');
    expect(composerIntent({ ...base, shiftKey: true })).toBe('newline');
  });
  it('an empty draft or a running answer swallows Enter, composing and other keys pass', () => {
    expect(composerIntent({ ...base, draft: '  ' })).toBe('swallow');
    expect(composerIntent({ ...base, sending: true })).toBe('swallow');
    expect(composerIntent({ ...base, isComposing: true })).toBe('ignore');
    expect(composerIntent({ ...base, key: 'a' })).toBe('ignore');
  });
});
