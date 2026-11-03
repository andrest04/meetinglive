import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  LibraryService,
  createAppPaths,
  type AppPaths,
  type AppSettings,
  type Clock,
  type Logger,
  type MeetingBusyProbe,
} from '@vozella/core';
import { writeFileAtomic } from '../fs/atomic-write';
import {
  ForbiddenDataRootError,
  LEGACY_FOLDER_NAME,
  assertNotLegacyRoot,
  type DataRoots,
  type RunMode,
} from '../data-root/resolve-data-root';
import { ensureDirectoriesExist } from './ensure-directories';
import { JsonFolderRepository } from './json-folder-repository';
import { JsonSettingsStore } from './json-settings-store';
import { errorCode } from './library-layout';
import { MarkdownMeetingRepository } from './markdown-meeting-repository';
import { runStartupMigrations } from './migrations';

export type LocationSource = DataRoots['source'] | 'chosen';
export type LibraryChangeReason = 'meeting' | 'folder' | 'location';

export interface LibraryLocation {
  readonly libraryRoot: string;
  readonly appDataRoot: string;
  readonly source: LocationSource;
  /** True when the Library root is inside a folder named MeetingLive (the WinUI app's data). */
  readonly sharesMeetingLive: boolean;
  readonly version: string;
  /** The first startup migration failure, if any. */
  readonly startupError: string | null;
}

export type SetLocationResult =
  | { readonly status: 'changed'; readonly location: LibraryLocation }
  | { readonly status: 'cancelled' }
  | {
      readonly status: 'refused';
      readonly reason: 'not-absolute' | 'forbidden' | 'unusable';
      readonly message: string;
    };

export interface OpenFolderResult {
  readonly opened: boolean;
  readonly error: string | null;
}

export interface LibraryRuntimeDeps {
  readonly mode: RunMode;
  /** From `resolveDataRoots`: the default Library root is `roots.meetings`. */
  readonly roots: DataRoots;
  readonly guard: {
    readonly localAppData: string;
    readonly documents: string;
    readonly tempDir: string;
    readonly realpath?: (path: string) => string;
  };
  readonly logger: Logger;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly busy: MeetingBusyProbe;
  /** Electron's `shell.openPath`: resolves to '' on success, otherwise an error message. */
  readonly openPath: (path: string) => Promise<string>;
  /** Shows a folder picker. Null when the user cancels. */
  readonly pickFolder: (defaultPath: string) => Promise<string | null>;
  readonly version: string;
  readonly onChanged?: (reason: LibraryChangeReason) => void;
}

const LOCATION_FILE = 'library-location.json';

/**
 * Owns where the library lives and the services built on that place. The app data root is fixed
 * for the process; the Library root can be changed in Settings.
 *
 * Folder choice rules (data safety): the environment override and the dev and test modes refuse
 * the existing MeetingLive folders. Only a production build with no override lets the user pick
 * any folder, including an existing MeetingLive library.
 */
export class LibraryRuntime {
  private services: Services | undefined;
  private chosen: string | null = null;
  private startupError: string | null = null;
  readonly settings: JsonSettingsStore;
  private readonly appPaths: () => AppPaths;

  constructor(private readonly deps: LibraryRuntimeDeps) {
    this.appPaths = () =>
      createAppPaths({ appData: deps.roots.appData, library: this.libraryRoot }, nodePath);
    this.settings = new JsonSettingsStore({
      settingsFilePath: nodePath.join(deps.roots.appData, 'settings.json'),
      ensureDirectories: () => ensureDirectoriesExist(this.appPaths()),
      logger: deps.logger,
    });
  }

  // -------------------------------------------------------------- lifecycle

  /** Reads the saved choice, builds the services, ensures directories and runs the migrations. */
  async start(): Promise<void> {
    this.chosen = await this.readChoice();
    await this.build();
  }

  get service(): LibraryService {
    return this.ready().service;
  }

  get meetings(): MarkdownMeetingRepository {
    return this.ready().meetings;
  }

  get folders(): JsonFolderRepository {
    return this.ready().folders;
  }

  get paths(): AppPaths {
    return this.ready().paths;
  }

  get libraryRoot(): string {
    return this.chosen ?? this.deps.roots.meetings;
  }

  location(): LibraryLocation {
    return {
      libraryRoot: this.libraryRoot,
      appDataRoot: this.deps.roots.appData,
      source: this.chosen === null ? this.deps.roots.source : 'chosen',
      sharesMeetingLive: this.libraryRoot
        .split(/[\\/]+/)
        .some((s) => s.toLowerCase() === LEGACY_FOLDER_NAME.toLowerCase()),
      version: this.deps.version,
      startupError: this.startupError,
    };
  }

  // ------------------------------------------------------------- location UI

  /** `null` goes back to the default folder. */
  async setLocation(path: string | null): Promise<SetLocationResult> {
    if (path === null) {
      await fs.rm(this.choiceFile(), { force: true });
      this.chosen = null;
      await this.build();
      this.deps.onChanged?.('location');
      return { status: 'changed', location: this.location() };
    }
    const refusal = await this.validateChoice(path);
    if (refusal) return refusal;

    const resolved = nodePath.resolve(path);
    await writeFileAtomic(this.choiceFile(), JSON.stringify({ libraryRoot: resolved }, null, 2));
    this.chosen = resolved;
    await this.build();
    this.deps.onChanged?.('location');
    return { status: 'changed', location: this.location() };
  }

  async chooseLocation(): Promise<SetLocationResult> {
    const picked = await this.deps.pickFolder(this.libraryRoot);
    return picked === null ? { status: 'cancelled' } : this.setLocation(picked);
  }

  /** Spec 2.17: ensures the directories exist, then opens the Library root in the file manager. */
  async openFolder(): Promise<OpenFolderResult> {
    try {
      await ensureDirectoriesExist(this.paths);
      const error = await this.deps.openPath(this.libraryRoot);
      return error === '' ? { opened: true, error: null } : { opened: false, error };
    } catch (error) {
      return { opened: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async loadSettings(): Promise<AppSettings> {
    return this.settings.load();
  }

  // ---------------------------------------------------------------- internals

  private ready(): Services {
    if (!this.services) throw new Error('The library runtime has not been started.');
    return this.services;
  }

  private choiceFile(): string {
    return nodePath.join(this.deps.roots.appData, LOCATION_FILE);
  }

  /** Where the guard is lifted: a production build that was not given an override. */
  private get permissive(): boolean {
    return this.deps.mode === 'production' && this.deps.roots.source === 'default';
  }

  private guardInput() {
    return {
      env: {},
      mode: this.deps.mode,
      localAppData: this.deps.guard.localAppData,
      documents: this.deps.guard.documents,
      tempDir: this.deps.guard.tempDir,
      realpath: this.deps.guard.realpath,
    };
  }

  private async validateChoice(path: string): Promise<SetLocationResult | undefined> {
    if (!nodePath.isAbsolute(path)) {
      return {
        status: 'refused',
        reason: 'not-absolute',
        message: 'The folder must be an absolute path.',
      };
    }
    if (!this.permissive) {
      try {
        assertNotLegacyRoot(nodePath.resolve(path), this.guardInput());
      } catch (error) {
        if (error instanceof ForbiddenDataRootError) {
          return { status: 'refused', reason: 'forbidden', message: error.message };
        }
        throw error;
      }
    }
    try {
      await fs.mkdir(path, { recursive: true });
      const stat = await fs.stat(path);
      if (!stat.isDirectory()) throw new Error('not a directory');
      await fs.access(path, fs.constants.W_OK);
    } catch (error) {
      return {
        status: 'refused',
        reason: 'unusable',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return undefined;
  }

  /** The saved choice, if it is still allowed. A refused or unreadable choice falls back quietly. */
  private async readChoice(): Promise<string | null> {
    let text: string;
    try {
      text = await fs.readFile(this.choiceFile(), 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
    try {
      const value = (JSON.parse(text) as { libraryRoot?: unknown }).libraryRoot;
      if (typeof value !== 'string' || !nodePath.isAbsolute(value)) return null;
      if (!this.permissive) assertNotLegacyRoot(nodePath.resolve(value), this.guardInput());
      return nodePath.resolve(value);
    } catch (error) {
      this.deps.logger.warn('ignoring the saved library folder', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async build(): Promise<void> {
    const paths = this.appPaths();
    await fs.mkdir(paths.rootDirectory, { recursive: true });
    await fs.mkdir(paths.userDataDirectory, { recursive: true });
    const folders = new JsonFolderRepository({
      foldersFilePath: paths.foldersFilePath,
      logger: this.deps.logger,
    });
    const meetings = new MarkdownMeetingRepository({
      root: paths.userDataDirectory,
      folders,
      logger: this.deps.logger,
    });
    const service = new LibraryService({
      meetings,
      folders,
      busy: this.deps.busy,
      clock: this.deps.clock,
      newId: this.deps.newId,
    });
    this.services = { paths, folders, meetings, service };

    await ensureDirectoriesExist(paths);
    const result = await runStartupMigrations({
      paths,
      meetings,
      folders,
      logger: this.deps.logger,
    });
    this.startupError = result.error;
  }
}

interface Services {
  readonly paths: AppPaths;
  readonly folders: JsonFolderRepository;
  readonly meetings: MarkdownMeetingRepository;
  readonly service: LibraryService;
}
