import nodePath from 'node:path';
import {
  ExitGateRegistry,
  LocalModelsService,
  RestartService,
  SettingsCommands,
  SettingsNotices,
  SettingsPageService,
  XaiAccountService,
  type CliPathProbe,
  type HardwareProbe,
  type LocalModelStore,
  type ModelEvent,
  type SettingsCapabilities,
  type SettingsStore,
  type XaiAccountPort,
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
  /** The xAI module registers its account here. Null until it exists. */
  readonly xaiAccount?: XaiAccountPort | null;
  /** True once the SuperGrok device code sign in exists. */
  readonly xaiSignIn?: boolean;
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
  readonly xai: XaiAccountService;
  readonly page: SettingsPageService;
  readonly restart: RestartService;
  readonly capabilities: SettingsCapabilities;

  constructor(deps: SettingsRuntimeDeps) {
    const xaiPort = deps.xaiAccount ?? null;
    this.capabilities = {
      xaiAccount: xaiPort !== null,
      xaiSignIn: xaiPort !== null && deps.xaiSignIn === true,
      localModels: true,
    };
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
    this.xai = new XaiAccountService({ port: xaiPort, store: deps.store });
    this.page = new SettingsPageService({
      store: deps.store,
      osLanguages: deps.osLanguages,
      hardware: deps.hardware ?? new SystemHardwareProbe(),
      models: this.models,
      xai: this.xai,
      cli: deps.cli ?? new PathCliProbe(),
      notices: this.notices,
      capabilities: this.capabilities,
    });
    this.restart = new RestartService({ gates: this.exitGates, relaunch: deps.relaunch });
  }
}
