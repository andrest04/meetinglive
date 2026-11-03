import nodePath from 'node:path';
import {
  ExitGateRegistry,
  LocalModelsService,
  RestartService,
  SettingsCommands,
  SettingsNotices,
  SettingsPageService,
  type CliPathProbe,
  type HardwareProbe,
  type LocalModelStore,
  type ModelEvent,
  type SettingsCapabilities,
  type SettingsStore,
} from '@vozella/core';
import { FileLocalModelStore } from './file-local-model-store';
import { PathCliProbe } from './path-cli-probe';
import { SystemHardwareProbe } from './system-hardware-probe';

export interface SettingsRuntimeDeps {
  readonly store: SettingsStore;
  /** `<app data>\SummaryModels`. */
  readonly appDataDirectory: string;
  /** Electron: `app.getPreferredSystemLanguages()`. */
  readonly osLanguages: () => readonly string[];
  /** Electron: `app.relaunch()` then `app.exit(0)`. */
  readonly relaunch: () => void | Promise<void>;
  readonly notifyModel: (event: ModelEvent) => void;
  /** Replacements for tests and for the fake native build. */
  readonly hardware?: HardwareProbe;
  readonly modelStore?: LocalModelStore;
  readonly cli?: CliPathProbe;
}

/**
 * The Settings services wired to their adapters. The composition root creates one; the IPC
 * handlers call it. Other modules reach their own Settings sections through `exitGates`,
 * the `store` they already share, and the ports named in the spec.
 */
export class SettingsRuntime {
  readonly notices = new SettingsNotices();
  readonly exitGates = new ExitGateRegistry();
  readonly commands: SettingsCommands;
  readonly models: LocalModelsService;
  readonly page: SettingsPageService;
  readonly restart: RestartService;
  readonly capabilities: SettingsCapabilities;
  private readonly hardwareProbe: HardwareProbe;

  constructor(deps: SettingsRuntimeDeps) {
    this.capabilities = { localModels: true };
    this.commands = new SettingsCommands({ store: deps.store, osLanguages: deps.osLanguages });
    this.models = new LocalModelsService({
      store:
        deps.modelStore ??
        new FileLocalModelStore({
          directory: nodePath.join(deps.appDataDirectory, 'SummaryModels'),
        }),
      settings: deps.store,
      notify: deps.notifyModel,
    });
    this.hardwareProbe = deps.hardware ?? new SystemHardwareProbe();
    this.page = new SettingsPageService({
      store: deps.store,
      osLanguages: deps.osLanguages,
      hardware: this.hardwareProbe,
      models: this.models,
      cli: deps.cli ?? new PathCliProbe(),
      notices: this.notices,
      capabilities: this.capabilities,
    });
    this.restart = new RestartService({ gates: this.exitGates, relaunch: deps.relaunch });
  }

  /**
   * Starts the hardware query now. It takes seconds on a real machine (a PowerShell GPU read) and
   * the Settings page needs it for the fit badges, so the app calls this once at startup and the
   * first visit finds the answer cached. A failed query only means no badges.
   */
  warmUp(): void {
    this.hardwareProbe.detect().catch(() => undefined);
  }
}
