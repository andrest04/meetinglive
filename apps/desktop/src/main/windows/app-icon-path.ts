import path from 'node:path';

export interface IconPathInput {
  readonly isPackaged: boolean;
  /** `process.resourcesPath`: the folder next to the exe that holds extra resources. */
  readonly resourcesPath: string;
  /** `app.getAppPath()`: the app folder in development. */
  readonly appPath: string;
}

export type IconName = 'icon.ico' | 'tray.ico';

/**
 * Absolute path of a bundled icon. Packaged builds copy them to `resources/icons` (a file the
 * shell can read, unlike one inside the archive); development reads `build/`. Never relative to
 * the working directory (bug 14).
 */
export function resolveIconPath(input: IconPathInput, name: IconName): string {
  return input.isPackaged
    ? path.resolve(input.resourcesPath, 'icons', name)
    : path.resolve(input.appPath, 'build', name);
}
