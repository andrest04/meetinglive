// Launches the packaged app (unsigned is fine) and checks it starts, writes its log under
// VOZELLA_DATA_ROOT, and carries the expected fuses.
//   node scripts/smoke-packaged.mjs [path-to-Vozella.exe] [--expect-inspect]
// Defaults to release/win-unpacked/Vozella.exe, the hardened release variant.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const expectInspect = args.includes('--expect-inspect');
const exe = path.resolve(
  args.find((a) => !a.startsWith('--')) ??
    path.join(here, '..', 'release', 'win-unpacked', 'Vozella.exe'),
);

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

if (!existsSync(exe)) {
  console.error(`not found: ${exe}. Run: pnpm package`);
  process.exit(1);
}

// Fuses
const wire = await getCurrentFuseWire(exe);
const enabled = (option) => wire[option] === FuseState.ENABLE;
check('fuse runAsNode disabled', !enabled(FuseV1Options.RunAsNode));
check('fuse NODE_OPTIONS disabled', !enabled(FuseV1Options.EnableNodeOptionsEnvironmentVariable));
check(
  `fuse node CLI inspect ${expectInspect ? 'enabled (e2e variant)' : 'disabled'}`,
  enabled(FuseV1Options.EnableNodeCliInspectArguments) === expectInspect,
);
check('fuse asar integrity enabled', enabled(FuseV1Options.EnableEmbeddedAsarIntegrityValidation));
check('fuse only load app from asar', enabled(FuseV1Options.OnlyLoadAppFromAsar));
check('fuse cookie encryption enabled', enabled(FuseV1Options.EnableCookieEncryption));
check(
  'fuse file protocol privileges disabled',
  !enabled(FuseV1Options.GrantFileProtocolExtraPrivileges),
);

// Launch
const dataRoot = mkdtempSync(path.join(tmpdir(), 'vozella-packaged-'));
const logFile = path.join(dataRoot, 'app', 'logs', 'main.log');
const child = spawn(exe, [], {
  env: { ...process.env, VOZELLA_DATA_ROOT: dataRoot },
  stdio: 'ignore',
});
let exitCode = null;
child.on('exit', (code) => {
  exitCode = code ?? -1;
});

const deadline = Date.now() + 30_000;
let log = '';
while (Date.now() < deadline && exitCode === null) {
  if (existsSync(logFile)) {
    log = readFileSync(logFile, 'utf8');
    if (log.includes('window ready')) break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 1500));

check('process still running', exitCode === null, exitCode === null ? '' : `exit ${exitCode}`);
check('log written under VOZELLA_DATA_ROOT', existsSync(logFile));
check('window ready logged', log.includes('window ready'));
check(
  'reports packaged production mode',
  log.includes('"packaged":true') && log.includes('"mode":"production"'),
);
check('data root source is env', log.includes('"dataRootSource":"env"'));
check('no uncaught exception logged', !log.includes('uncaught exception'));

if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
rmSync(dataRoot, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\npackaged smoke passed');
