/**
 * The checked set, apart from the cursor: the cursor is what the preview shows, the checks are what
 * an action applies to. `anchorId` and `base` make a Shift range grow and shrink from where it
 * began without losing what was checked before it.
 */
export interface Checks {
  readonly checked: ReadonlySet<string>;
  readonly anchorId: string | null;
  readonly base: ReadonlySet<string>;
}

const NOTHING: ReadonlySet<string> = new Set();

export const EMPTY_CHECKS: Checks = { checked: NOTHING, anchorId: null, base: NOTHING };

const settled = (checked: ReadonlySet<string>, anchorId: string | null): Checks => ({
  checked,
  anchorId,
  base: checked,
});

export function toggleCheck(checks: Checks, id: string): Checks {
  const checked = new Set(checks.checked);
  if (checked.has(id)) checked.delete(id);
  else checked.add(id);
  return settled(checked, id);
}

/** From the anchor to `toId`, or from `fromId` when no anchor in the list is there to start from. */
export function extendChecks(
  checks: Checks,
  ids: readonly string[],
  fromId: string,
  toId: string,
): Checks {
  const kept = checks.anchorId !== null && ids.includes(checks.anchorId) ? checks.anchorId : null;
  const anchorId = kept ?? fromId;
  const base = kept === null ? checks.checked : checks.base;
  const start = ids.indexOf(anchorId);
  const end = ids.indexOf(toId);
  if (start === -1 || end === -1) return checks;
  const range = ids.slice(Math.min(start, end), Math.max(start, end) + 1);
  return { checked: new Set([...base, ...range]), anchorId, base };
}

/** A whole day at once. The set is settled, so a later Shift range starts from here. */
export function setGroup(checks: Checks, ids: readonly string[], on: boolean): Checks {
  const checked = new Set(checks.checked);
  for (const id of ids) {
    if (on) checked.add(id);
    else checked.delete(id);
  }
  return settled(checked, checks.anchorId);
}

export const checkAll = (ids: readonly string[]): Checks => settled(new Set(ids), null);

/** All, some or none of a group, the way `aria-checked` says it. */
export function groupState(
  checked: ReadonlySet<string>,
  ids: readonly string[],
): boolean | 'mixed' {
  const count = ids.filter((id) => checked.has(id)).length;
  if (count === 0) return false;
  return count === ids.length ? true : 'mixed';
}

/** After a refresh: only what is still listed. Unchanged keeps its identity, so nothing renders. */
export function keepLive(checks: Checks, ids: readonly string[]): Checks {
  const live = new Set(ids);
  const stale = (set: ReadonlySet<string>): boolean => [...set].some((id) => !live.has(id));
  if (!stale(checks.checked) && !stale(checks.base)) return checks;
  const only = (set: ReadonlySet<string>): ReadonlySet<string> =>
    new Set([...set].filter((id) => live.has(id)));
  return {
    checked: only(checks.checked),
    anchorId: checks.anchorId,
    base: only(checks.base),
  };
}
