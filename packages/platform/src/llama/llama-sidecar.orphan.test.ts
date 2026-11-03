import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FAKE_SERVER,
  pidAlive,
  startOrphanChild,
  waitUntil,
  type OrphanChild,
} from './test-fixtures/orphan-harness';

/**
 * The no-orphan proof against the fake server: a child Node process owns the sidecar and is
 * then killed with no chance to clean up. The Job Object case needs the built native addon.
 */
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const addonPath = nodePath.resolve(
  here,
  '../../../../native/vozella-native/vozella-native.win32-x64-msvc.node',
);
const hasAddon = process.platform === 'win32' && fs.existsSync(addonPath);

const started: OrphanChild[] = [];
afterEach(() => {
  for (const { child, serverPid } of started.splice(0)) {
    try {
      child.kill();
    } catch {
      // gone
    }
    try {
      process.kill(serverPid);
    } catch {
      // gone
    }
  }
});

function hardKillTree(pid: number): void {
  // /F is TerminateProcess: no exit handlers run. No /T, so only the owner dies.
  execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true });
}

async function launch(useJob: boolean): Promise<OrphanChild> {
  const orphan = await startOrphanChild({
    exe: process.execPath,
    modelPath: 'fake.gguf',
    gpuLayers: 0,
    argsPrefix: [FAKE_SERVER],
    addonPath: useJob ? addonPath : undefined,
  });
  started.push(orphan);
  return orphan;
}

describe('no orphan after the owner dies (fake server)', () => {
  it('watchdog: the server disappears after a hard kill of the owner', async () => {
    const { child, serverPid } = await launch(false);
    expect(pidAlive(serverPid)).toBe(true);
    hardKillTree(child.pid!);
    expect(await waitUntil(() => !pidAlive(serverPid), 8000)).toBe(true);
  }, 60_000);

  it.skipIf(!hasAddon)(
    'job object: the server disappears after a hard kill of the owner',
    async () => {
      const { child, serverPid } = await launch(true);
      expect(pidAlive(serverPid)).toBe(true);
      hardKillTree(child.pid!);
      expect(await waitUntil(() => !pidAlive(serverPid), 5000)).toBe(true);
    },
    60_000,
  );
});
