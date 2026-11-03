import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A tiny fake CLI for runner tests. Never a real claude or codex. The behavior is picked by the
 * first argument after the script: echo, bytes, fail, silent-fail, silent-ok, hang, pid-hang.
 */
const SCRIPT = `
const fs = require('node:fs');
const mode = process.argv[2];
const arg = process.argv[3];
function readAll(cb) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => cb(Buffer.concat(chunks)));
}
if (mode === 'echo') {
  // Echo while reading, so a large prompt and a large echo fill both pipes.
  process.stdin.on('data', (c) => process.stdout.write(c));
  process.stdin.on('end', () => process.exit(0));
} else if (mode === 'bytes') {
  readAll((b) => process.stdout.write(b.subarray(0, 3).toString('hex') + ':' + b.length));
} else if (mode === 'args') {
  process.stdout.write(JSON.stringify(process.argv.slice(3)));
} else if (mode === 'fail') {
  readAll(() => { process.stderr.write(arg || 'boom'); process.exit(3); });
} else if (mode === 'silent-fail') {
  process.stderr.write(arg || 'not logged in'); process.exit(1);
} else if (mode === 'silent-ok') {
  process.stdout.write('done'); process.exit(0);
} else if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'pid-hang') {
  fs.writeFileSync(arg, String(process.pid));
  setInterval(() => {}, 1000);
}
`;

export interface FakeCliInstall {
  /** Directory to put on PATH. Holds fakecli.cmd (Windows) and the plain launcher. */
  readonly binDir: string;
  /** Absolute path of the Node script the shims point at. */
  readonly script: string;
  readonly cleanup: () => void;
}

/** Writes the fake CLI under a temp directory inside VOZELLA_DATA_ROOT (or the OS temp). */
export function installFakeCli(): FakeCliInstall {
  const base = process.env.VOZELLA_DATA_ROOT ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'fake-cli-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  const script = path.join(root, 'fake-cli.cjs');
  fs.writeFileSync(script, SCRIPT);
  if (process.platform === 'win32') {
    // The .cmd shim, like npm installs for claude and codex. The script is the first argument.
    fs.writeFileSync(
      path.join(binDir, 'fakecmd.cmd'),
      `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
    );
    // A plain .exe: a copy of node itself, so no shim is involved.
    fs.copyFileSync(process.execPath, path.join(binDir, 'fakeexe.exe'));
  } else {
    fs.symlinkSync(process.execPath, path.join(binDir, 'fakeexe'));
  }
  return { binDir, script, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
