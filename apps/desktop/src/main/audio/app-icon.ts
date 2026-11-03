/** The part of Electron's NativeImage the provider reads. */
export interface IconImage {
  isEmpty(): boolean;
  toDataURL(): string;
}

/**
 * Icons of the executables behind the app cards (spec 131). Only absolute local `.exe` paths are
 * read, each once per run: success and failure are both remembered, and simultaneous callers share
 * one lookup. The adapter is Electron's `app.getFileIcon`.
 */
export function createAppIconProvider(
  getIcon: (exePath: string) => Promise<IconImage>,
): (exePath: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  return (exePath) => {
    if (!/^[a-z]:[\\/]/i.test(exePath) || !/\.exe$/i.test(exePath) || /\.\.[\\/]/.test(exePath)) {
      return Promise.resolve(null);
    }
    const key = exePath.toLowerCase();
    let pending = cache.get(key);
    if (!pending) {
      pending = getIcon(exePath).then(
        (image) => (image.isEmpty() ? null : image.toDataURL()),
        () => null,
      );
      cache.set(key, pending);
    }
    return pending;
  };
}
