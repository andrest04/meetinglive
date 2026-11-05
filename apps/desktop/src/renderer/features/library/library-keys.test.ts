import { describe, expect, it } from 'vitest';
import { gridKeyAction } from './library-keys';

const key = (name: string, extra: { shiftKey?: boolean } = {}) => ({
  key: name,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...extra,
});

describe('gridKeyAction', () => {
  it('names what each key does on a row', () => {
    expect(gridKeyAction(key('Enter'))).toBe('open');
    expect(gridKeyAction(key(' '))).toBe('toggle');
    expect(gridKeyAction(key('F2'))).toBe('rename');
    expect(gridKeyAction(key('Delete'))).toBe('delete');
    expect(gridKeyAction(key('Delete', { shiftKey: true }))).toBe('deletePermanently');
    expect(gridKeyAction(key('Escape'))).toBe('clear');
  });

  it('leaves everything else alone, also with Shift', () => {
    expect(gridKeyAction(key('a'))).toBeNull();
    expect(gridKeyAction(key('ArrowDown'))).toBeNull();
    expect(gridKeyAction(key('Enter', { shiftKey: true }))).toBeNull();
    expect(gridKeyAction(key('F2', { shiftKey: true }))).toBeNull();
    expect(gridKeyAction(key(' ', { shiftKey: true }))).toBeNull();
  });

  it('ignores chords', () => {
    expect(gridKeyAction({ ...key('Delete'), ctrlKey: true })).toBeNull();
    expect(gridKeyAction({ ...key('Enter'), altKey: true })).toBeNull();
    expect(gridKeyAction({ ...key(' '), metaKey: true })).toBeNull();
  });
});
