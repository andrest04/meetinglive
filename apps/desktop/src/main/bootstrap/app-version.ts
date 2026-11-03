import fs from 'node:fs';
import path from 'node:path';

/**
 * The version shown in Settings. `app.getVersion()` is not trusted: when Electron starts from the
 * built folder it finds no package file and answers with the Electron runtime version. The package
 * file of the desktop app is read instead; it sits two levels above `out/main`, in the repository
 * and inside the packaged archive alike.
 */
export function resolveAppVersion(
  mainDir: string,
  fallback: string,
  readText: (file: string) => string = (file) => fs.readFileSync(file, 'utf8'),
): string {
  try {
    const parsed: unknown = JSON.parse(readText(path.join(mainDir, '..', '..', 'package.json')));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const version = parsed.version;
      if (typeof version === 'string' && /^\d+(\.\d+){1,3}/.test(version.trim())) {
        return version.trim();
      }
    }
  } catch {
    // Fall through to the caller's value.
  }
  return fallback;
}
