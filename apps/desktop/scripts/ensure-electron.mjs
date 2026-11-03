// pnpm 12 does not run dependency install scripts unless allow-listed, and a download can
// fail on a flaky network. This makes the Electron binary present or fails loudly.
// Runs from the root `postinstall`, and can be run by hand: node apps/desktop/scripts/ensure-electron.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));
const ATTEMPTS = 3;

function electronDir() {
  try {
    return path.dirname(require.resolve('electron/package.json'));
  } catch {
    return null;
  }
}

function binaryPresent(dir) {
  const pathFile = path.join(dir, 'path.txt');
  if (!existsSync(pathFile)) return false;
  return existsSync(path.join(dir, 'dist', readFileSync(pathFile, 'utf8').trim()));
}

const dir = electronDir();
if (!dir) {
  console.log('[ensure-electron] electron is not installed yet, nothing to do');
  process.exit(0);
}
if (binaryPresent(dir)) {
  console.log('[ensure-electron] Electron binary present');
  process.exit(0);
}

const env = { ...process.env };
delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  console.log(`[ensure-electron] downloading the Electron binary (attempt ${attempt}/${ATTEMPTS})`);
  const result = spawnSync(process.execPath, [path.join(dir, 'install.js')], {
    cwd: dir,
    env,
    stdio: 'inherit',
  });
  if (result.status === 0 && binaryPresent(dir)) {
    console.log('[ensure-electron] Electron binary ready');
    process.exit(0);
  }
}
console.error(
  '[ensure-electron] could not fetch the Electron binary; check the network or electron_mirror in .npmrc',
);
process.exit(1);
