import fs from 'node:fs';
import path from 'node:path';
import {
  CancelSource,
  CliToolError,
  CliTimeoutError,
  isCancellation,
  runRequiredStdout,
  type CancelSignal,
} from '@vozella/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCmdWrapperArgs, NodeCliProcessRunner } from './cli-process-runner';
import { installFakeCli, type FakeCliInstall } from './fake-cli-fixture';

const windows = process.platform === 'win32';
const never: CancelSignal = new CancelSource().signal;

let fake: FakeCliInstall;
let runner: NodeCliProcessRunner;
beforeAll(() => {
  fake = installFakeCli();
  runner = new NodeCliProcessRunner({ env: { PATH: fake.binDir } });
});
afterAll(() => fake.cleanup());

/** The plain executable form: a copy of node that takes the script as its first argument. */
const exe = (...args: string[]) => ['fakeexe', [fake.script, ...args]] as const;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor<T>(read: () => T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('PATH lookup (items 63, 64)', () => {
  it('finds the program and returns its full path', async () => {
    expect(await runner.isOnPath('fakeexe')).toBe(true);
    const found = await runner.resolveExecutable('fakeexe');
    expect(found && path.dirname(found)).toBe(fake.binDir);
  });

  it('is false for a program that is not there', async () => {
    expect(await runner.isOnPath('no-such-cli')).toBe(false);
    expect(await runner.resolveExecutable('no-such-cli')).toBeNull();
  });

  it.runIf(windows)('finds a .cmd shim through PATHEXT', async () => {
    expect(await runner.resolveExecutable('fakecmd')).toMatch(/fakecmd\.cmd$/i);
  });
});

describe('run (items 58, 65 to 69)', () => {
  it('returns the exit code and stdout', async () => {
    const result = await runner.run(...exe('silent-ok'), null, 10_000, never);
    expect(result).toEqual({ exitCode: 0, stdout: 'done', stderr: '' });
  });

  it('delivers stdin', async () => {
    const [file, args] = exe('echo');
    const result = await runner.run(file, args, 'hello prompt', 10_000, never);
    expect(result.stdout).toBe('hello prompt');
  });

  it('round trips Spanish text as UTF-8', async () => {
    const text = 'Reunión: ¿qué decisión tomó Ángel? Añadir acción, día 3 – ok ✓';
    const [file, args] = exe('echo');
    expect((await runner.run(file, args, text, 10_000, never)).stdout).toBe(text);
  });

  it('writes stdin without a byte order mark (B24)', async () => {
    const [file, args] = exe('bytes');
    const result = await runner.run(file, args, 'Reunión', 10_000, never);
    const [head, length] = result.stdout.split(':');
    expect(head).not.toBe('efbbbf');
    expect(head).toBe('52'.concat('65', '75')); // "Reu"
    expect(Number(length)).toBe(Buffer.byteLength('Reunión', 'utf8'));
  });

  it('passes arguments as separate items', async () => {
    const result = await runner.run(
      'fakeexe',
      [fake.script, 'args', 'a b', '-p'],
      null,
      10_000,
      never,
    );
    expect(JSON.parse(result.stdout)).toEqual(['a b', '-p']);
  });

  it('reports a missing executable as not installed', async () => {
    const error = await runner.run('no-such-cli', [], null, 5000, never).catch((e: unknown) => e);
    expect((error as { code?: string }).code).toBe('ENOENT');
    const wrapped = await runRequiredStdout(
      runner,
      'no-such-cli',
      [],
      null,
      5000,
      'Fake',
      never,
    ).catch((e: unknown) => e);
    expect(wrapped).toBeInstanceOf(CliToolError);
    expect((wrapped as CliToolError).kind).toBe('NotInstalled');
  });

  it('kills the process on timeout and the pid is gone', async () => {
    const pidFile = path.join(fake.binDir, '..', 'timeout.pid');
    const pending = runner.run('fakeexe', [fake.script, 'pid-hang', pidFile], null, 1500, never);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliTimeoutError);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await waitFor(() => (alive(pid) ? undefined : true));
    expect(alive(pid)).toBe(false);
  });

  it('a child that fails without reading stdin reports the exit code and stderr', async () => {
    const big = 'x'.repeat(8 * 1024 * 1024);
    const [file, args] = exe('silent-fail', 'boom from child');
    const result = await runner.run(file, args, big, 20_000, never);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('boom from child');
  });

  it('classifies an early auth failure from the real failure, not the stdin error', async () => {
    const big = 'x'.repeat(8 * 1024 * 1024);
    const [file, args] = exe('silent-fail', 'Error: not logged in. Please run login');
    const error = await runRequiredStdout(runner, file, args, big, 20_000, 'Fake', never).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CliToolError);
    expect((error as CliToolError).kind).toBe('NotSignedIn');
  });

  it('a success that did not read all of its input is not a success', async () => {
    const big = 'x'.repeat(8 * 1024 * 1024);
    const [file, args] = exe('silent-ok');
    await expect(runner.run(file, args, big, 20_000, never)).rejects.toThrow(
      'exited before reading all of its input',
    );
  });

  it('a large prompt and a large echo do not deadlock', async () => {
    const big = 'ñ'.repeat(4 * 1024 * 1024);
    const [file, args] = exe('echo');
    const result = await runner.run(file, args, big, 60_000, never);
    expect(result.stdout.length).toBe(big.length);
    expect(result.stdout === big).toBe(true);
  }, 90_000);

  it('a hang that never reads stdin times out', async () => {
    const big = 'x'.repeat(8 * 1024 * 1024);
    const [file, args] = exe('hang');
    const started = Date.now();
    await expect(runner.run(file, args, big, 1000, never)).rejects.toBeInstanceOf(CliTimeoutError);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('caller cancellation while stdin is blocked rethrows the cancellation', async () => {
    const big = 'x'.repeat(8 * 1024 * 1024);
    const source = new CancelSource();
    const [file, args] = exe('hang');
    const pending = runner.run(file, args, big, 60_000, source.signal).catch((e: unknown) => e);
    setTimeout(() => source.cancel(), 300);
    const error = await pending;
    expect(isCancellation(error)).toBe(true);
  });

  it('a signal that is already cancelled never starts the process', async () => {
    const source = new CancelSource();
    source.cancel();
    const error = await runner
      .run(...exe('silent-ok'), null, 5000, source.signal)
      .catch((e: unknown) => e);
    expect(isCancellation(error)).toBe(true);
  });
});

describe('cmd shim (B11)', () => {
  it.runIf(windows)('launches the resolved .cmd through cmd.exe, prompt on stdin', async () => {
    const text = 'Reunión con acentos';
    const result = await runner.run('fakecmd', ['echo'], text, 15_000, never);
    expect(result).toMatchObject({ exitCode: 0, stdout: text });
  });

  it.runIf(windows)('passes cmd arguments quoted', async () => {
    const result = await runner.run('fakecmd', ['args', 'a b', '-p'], null, 15_000, never);
    expect(JSON.parse(result.stdout)).toEqual(['a b', '-p']);
  });

  it.runIf(windows)('kills the whole tree of a .cmd on timeout', async () => {
    const pidFile = path.join(fake.binDir, '..', 'cmd.pid');
    const error = await runner
      .run('fakecmd', ['pid-hang', pidFile], null, 2500, never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliTimeoutError);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await waitFor(() => (alive(pid) ? undefined : true));
    expect(alive(pid)).toBe(false);
  });

  it('doubles a quote inside an argument', () => {
    const wrapped = buildCmdWrapperArgs('C:\\x\\codex.cmd', ['-c', 'effort="low"']);
    expect(wrapped[3]).toBe('""C:\\x\\codex.cmd" "-c" "effort=""low""""');
  });

  it.runIf(windows)('passes a quote-bearing argument through a real .cmd shim', async () => {
    const arg = 'model_reasoning_effort="low"';
    const result = await runner.run('fakecmd', ['args', arg], null, 15_000, never);
    expect(JSON.parse(result.stdout)).toEqual([arg]);
  });

  it('refuses arguments that could break out of the cmd.exe quoting', () => {
    for (const bad of ['%PATH%', 'a\nb']) {
      expect(() => buildCmdWrapperArgs('C:\\x\\claude.cmd', ['-p', bad])).toThrow();
    }
    expect(buildCmdWrapperArgs('C:\\x\\claude.cmd', ['-p', 'a b'])).toEqual([
      '/d',
      '/s',
      '/c',
      '""C:\\x\\claude.cmd" "-p" "a b""',
    ]);
  });
});
