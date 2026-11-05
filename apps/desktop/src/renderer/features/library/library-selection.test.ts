import { describe, expect, it } from 'vitest';
import {
  EMPTY_CHECKS,
  checkAll,
  extendChecks,
  groupState,
  keepLive,
  setGroup,
  toggleCheck,
} from './library-selection';

const ids = ['a', 'b', 'c', 'd', 'e'];
const list = (checks: { checked: ReadonlySet<string> }): string[] => [...checks.checked].sort();

describe('toggleCheck', () => {
  it('flips one row and makes it the anchor', () => {
    const on = toggleCheck(EMPTY_CHECKS, 'b');
    expect(list(on)).toEqual(['b']);
    expect(on.anchorId).toBe('b');
    expect(list(toggleCheck(on, 'b'))).toEqual([]);
  });
});

describe('extendChecks', () => {
  it('checks from the first row to the target, in either direction', () => {
    expect(list(extendChecks(EMPTY_CHECKS, ids, 'b', 'd'))).toEqual(['b', 'c', 'd']);
    expect(list(extendChecks(EMPTY_CHECKS, ids, 'd', 'b'))).toEqual(['b', 'c', 'd']);
  });

  it('shrinks back when the range comes back toward the anchor', () => {
    const wide = extendChecks(EMPTY_CHECKS, ids, 'b', 'e');
    expect(list(extendChecks(wide, ids, 'e', 'c'))).toEqual(['b', 'c']);
  });

  it('keeps what was checked before the range began', () => {
    const before = toggleCheck(EMPTY_CHECKS, 'a');
    const anchored = toggleCheck(before, 'c');
    expect(list(extendChecks(anchored, ids, 'c', 'e'))).toEqual(['a', 'c', 'd', 'e']);
  });

  it('starts over when the anchor left the list', () => {
    const gone = toggleCheck(EMPTY_CHECKS, 'x');
    expect(list(extendChecks(gone, ids, 'a', 'b'))).toEqual(['a', 'b', 'x']);
  });
});

describe('setGroup and groupState', () => {
  it('checks and unchecks a whole day', () => {
    const on = setGroup(toggleCheck(EMPTY_CHECKS, 'a'), ['c', 'd'], true);
    expect(list(on)).toEqual(['a', 'c', 'd']);
    expect(list(setGroup(on, ['c', 'd'], false))).toEqual(['a']);
  });

  it('says whether a day is all, some or none checked', () => {
    const on = setGroup(EMPTY_CHECKS, ['c'], true);
    expect(groupState(on.checked, ['c'])).toBe(true);
    expect(groupState(on.checked, ['c', 'd'])).toBe('mixed');
    expect(groupState(on.checked, ['d'])).toBe(false);
  });
});

describe('checkAll and keepLive', () => {
  it('checks every row', () => {
    expect(list(checkAll(ids))).toEqual(ids);
  });

  it('drops rows that went away and keeps the object when nothing changed', () => {
    const on = checkAll(['a', 'b']);
    expect(keepLive(on, ['a', 'b', 'c'])).toBe(on);
    expect(list(keepLive(on, ['b']))).toEqual(['b']);
  });
});
