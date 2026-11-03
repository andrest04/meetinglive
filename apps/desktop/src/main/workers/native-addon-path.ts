import path from 'node:path';

export function nativeAddonFileName(platform: string, arch: string): string {
  if (platform === 'win32' && arch === 'x64') return 'vozella-native.win32-x64-msvc.node';
  throw new Error(`no native addon is built for ${platform}-${arch}`);
}

/**
 * Where the .node file lives. Packaged: next to app.asar, in app.asar.unpacked (a native
 * library cannot be loaded from inside an archive). Unpackaged: where the workspace build
 * leaves it, found from the bundle (app.getAppPath is the script folder when launched by
 * path, as the e2e tests do).
 */
export function resolveNativeAddonPath(options: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  /** Directory of the bundled main script (out/main). */
  readonly mainDir: string;
  readonly platform: string;
  readonly arch: string;
}): string {
  const file = nativeAddonFileName(options.platform, options.arch);
  return options.isPackaged
    ? path.join(options.resourcesPath, 'app.asar.unpacked', 'out', 'native', file)
    : path.resolve(options.mainDir, '..', '..', '..', '..', 'native', 'vozella-native', file);
}
