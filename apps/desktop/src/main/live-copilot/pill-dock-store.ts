import {
  dockPatch,
  resolveDock,
  shouldSaveDock,
  type DockState,
  type SettingsStore,
} from '@vozella/core';
import type { PillDockStorePort } from './pill-controller';

/**
 * The dock position in the settings file (spec 4.1). Reads throw so the controller can retry at
 * the next show; writes never throw.
 *
 * Bug 12: `update` is the settings store's own locked read-modify-write and the patch names only
 * the two dock fields, so a concurrent settings change is not overwritten. The monitor is not
 * persisted (bug 6): after a restart the pill docks on the primary display first, as WinUI did.
 */
export class PillDockStore implements PillDockStorePort {
  constructor(
    private readonly settings: Pick<SettingsStore, 'load' | 'update'>,
    private readonly logger: { warn(message: string, context?: Record<string, unknown>): void },
  ) {}

  async load(): Promise<DockState> {
    return resolveDock(await this.settings.load());
  }

  async save(state: DockState): Promise<void> {
    try {
      const saved = await this.settings.load();
      if (!shouldSaveDock(saved, state)) return;
      await this.settings.update(dockPatch(state));
    } catch (error) {
      this.logger.warn('pill dock save failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
