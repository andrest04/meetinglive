/**
 * Development only: when a hot update leaves the window blank or crashes the tree, reload the
 * page instead of leaving a black window. A guard in sessionStorage keeps this from looping.
 */

export const AUTO_RELOAD_KEY = 'vozella.hmr.autoReloadAt';
/** At most one automatic reload per this many milliseconds. */
export const AUTO_RELOAD_GUARD_MS = 5_000;
/** A render crash this soon after a hot update is blamed on the update. */
export const CRASH_AFTER_UPDATE_MS = 3_000;
/** How long after an update the root must have content again. */
export const ROOT_CHECK_DELAY_MS = 1_500;

export type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function mayAutoReload(lastReloadAt: number | undefined, now: number): boolean {
  if (lastReloadAt === undefined) return true;
  // A stored time in the future means the clock moved; do not trust it.
  if (lastReloadAt > now) return true;
  return now - lastReloadAt >= AUTO_RELOAD_GUARD_MS;
}

/** Takes the reload slot if the guard allows it, and records the time. */
export function claimAutoReload(storage: ReloadStorage, now: number): boolean {
  const stored = Number(storage.getItem(AUTO_RELOAD_KEY));
  const last = Number.isFinite(stored) && stored > 0 ? stored : undefined;
  if (!mayAutoReload(last, now)) return false;
  storage.setItem(AUTO_RELOAD_KEY, String(now));
  return true;
}

export interface HmrRecoveryDeps {
  readonly storage: ReloadStorage;
  readonly now: () => number;
  readonly reload: () => void;
  readonly isRootEmpty: () => boolean;
}

export interface HmrRecovery {
  /** Call after every applied hot update. */
  afterUpdate(): void;
  /** Call a moment after an update: reloads when the root rendered nothing. */
  checkRoot(): void;
  /** Call when the root error boundary catches; returns true when it reloaded. */
  renderCrashed(): boolean;
}

export function createHmrRecovery(deps: HmrRecoveryDeps): HmrRecovery {
  let lastUpdateAt: number | undefined;
  const reload = (): boolean => {
    if (!claimAutoReload(deps.storage, deps.now())) return false;
    deps.reload();
    return true;
  };
  return {
    afterUpdate() {
      lastUpdateAt = deps.now();
    },
    checkRoot() {
      if (deps.isRootEmpty()) reload();
    },
    renderCrashed() {
      if (lastUpdateAt === undefined) return false;
      if (deps.now() - lastUpdateAt > CRASH_AFTER_UPDATE_MS) return false;
      return reload();
    },
  };
}

let installed: HmrRecovery | undefined;

/** Wires the recovery to Vite's hot client. A no-op outside the dev server. */
export function installHmrRecovery(
  hot: ImportMeta['hot'],
  root: HTMLElement,
  log: (message: string) => void,
): void {
  if (!hot || installed) return;
  const recovery = createHmrRecovery({
    storage: window.sessionStorage,
    now: () => Date.now(),
    reload: () => {
      log('hot update left the window broken, reloading');
      window.location.reload();
    },
    isRootEmpty: () => root.childElementCount === 0,
  });
  installed = recovery;
  hot.on('vite:afterUpdate', () => {
    recovery.afterUpdate();
    window.setTimeout(() => {
      recovery.checkRoot();
    }, ROOT_CHECK_DELAY_MS);
  });
}

/** For the root error boundary: reloads when the crash follows a hot update (dev only). */
export function recoverFromRenderCrash(): boolean {
  return installed?.renderCrashed() ?? false;
}
