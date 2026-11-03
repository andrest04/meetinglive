import fs from 'node:fs';
import type { WindowScanPort } from '@vozella/core';

/**
 * Test-only scanner for the e2e specs: a call is "open" while a flag file exists. Selected with
 * VOZELLA_FAKE_CALL_FLAG=<path>, and only when the app runs in test mode.
 */
export function createFlagFileScanner(flagPath: string): WindowScanPort {
  return { anyMeetingWindow: () => Promise.resolve(fs.existsSync(flagPath)) };
}

/** The flag path from the environment, or undefined outside test mode. */
export function fakeCallFlagPath(
  env: Readonly<Record<string, string | undefined>>,
  testMode: boolean,
): string | undefined {
  const value = env.VOZELLA_FAKE_CALL_FLAG;
  return testMode && value ? value : undefined;
}
