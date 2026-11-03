import type { RunMode } from '@vozella/platform';

/**
 * Packaged builds are production. Anything else is dev, or test when an automated run says
 * so. The data-root guard is stricter outside production.
 */
export function resolveRunMode(
  isPackaged: boolean,
  env: Readonly<Record<string, string | undefined>>,
): RunMode {
  if (isPackaged) return 'production';
  return env.VOZELLA_E2E === '1' || env.NODE_ENV === 'test' ? 'test' : 'development';
}

export function isFakeNative(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.VOZELLA_FAKE_NATIVE === '1';
}
