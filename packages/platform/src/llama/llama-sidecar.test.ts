import nodePath from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CancelledError, CancelSource } from '@vozella/core';
import { FakeProcessJob } from '../fakes/fake-process-job';
import { LlamaSidecar, LlamaSidecarError, type LlamaStartOptions } from './llama-sidecar';
import { JobProcessGuard, type ProcessGuard } from './process-guard';
import { FAKE_SERVER, pidAlive, waitUntil } from './test-fixtures/orphan-harness';

const noGuard: ProcessGuard = {
  protect: () => ({ mechanism: 'job', release: () => undefined }),
};

interface Info {
  argv: string[];
  cwd: string;
  stats: { chatStarted: number; chatAborted: number };
}

function startOptions(extra: Partial<LlamaStartOptions> = {}): LlamaStartOptions {
  return {
    exe: process.execPath,
    modelPath: 'C:/models/fake.gguf',
    argsPrefix: [FAKE_SERVER],
    healthTimeoutMs: 15_000,
    ...extra,
  };
}

const sidecars: LlamaSidecar[] = [];
function make(options: Partial<ConstructorParameters<typeof LlamaSidecar>[0]> = {}) {
  const sidecar = new LlamaSidecar({ guard: noGuard, healthPollMs: 25, ...options });
  sidecars.push(sidecar);
  return sidecar;
}

afterEach(async () => {
  await Promise.all(sidecars.splice(0).map((s) => s.stop()));
});

function portOf(sidecar: LlamaSidecar): number {
  return (sidecar as unknown as { running: { port: number } }).running.port;
}

async function infoOf(sidecar: LlamaSidecar): Promise<Info> {
  const response = await fetch(`http://127.0.0.1:${portOf(sidecar)}/__info`);
  return (await response.json()) as Info;
}

function argAfter(argv: string[], flag: string): string {
  return argv[argv.indexOf(flag) + 1]!;
}

describe('LlamaSidecar start', () => {
  it('waits for /health to turn 200 while the model loads', async () => {
    const sidecar = make();
    const started = Date.now();
    await sidecar.start(startOptions({ extraArgs: ['--fake-load-ms', '400'] }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    expect(sidecar.isRunning).toBe(true);
  });

  it('fails fast with the output tail when the process exits early', async () => {
    const sidecar = make();
    const started = Date.now();
    const error = await sidecar
      .start(startOptions({ extraArgs: ['--fake-exit-early'] }))
      .catch((e: unknown) => e as LlamaSidecarError);
    expect(error).toBeInstanceOf(LlamaSidecarError);
    expect((error as LlamaSidecarError).code).toBe('exited-early');
    expect((error as Error).message).toContain('failed to load model, simulated');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('times out and leaves no process when the model never loads', async () => {
    const sidecar = make();
    const error = await sidecar
      .start(startOptions({ extraArgs: ['--fake-load-ms', '60000'], healthTimeoutMs: 400 }))
      .catch((e: unknown) => e as LlamaSidecarError);
    expect((error as LlamaSidecarError).code).toBe('health-timeout');
    expect(sidecar.isRunning).toBe(false);
  });

  it('reports a missing executable as a spawn error', async () => {
    const sidecar = make();
    const error = await sidecar
      .start({ exe: 'C:/does/not/exist/llama-server.exe', modelPath: 'm.gguf' })
      .catch((e: unknown) => e as LlamaSidecarError);
    expect((error as LlamaSidecarError).code).toBe('spawn');
  });

  it('passes the documented arguments, runs in the exe folder and uses a fresh 24-byte key', async () => {
    const first = make();
    await first.start(startOptions({ contextTokens: 2048, gpuLayers: 'auto' }));
    const second = make();
    await second.start(startOptions());
    const info = await infoOf(first);
    expect(argAfter(info.argv, '-m')).toBe('C:/models/fake.gguf');
    expect(argAfter(info.argv, '--host')).toBe('127.0.0.1');
    expect(argAfter(info.argv, '-c')).toBe('2048');
    expect(info.argv).toContain('--no-webui');
    expect(argAfter(info.argv, '-ngl')).toBe('999');
    expect(nodePath.resolve(info.cwd).toLowerCase()).toBe(
      nodePath.dirname(process.execPath).toLowerCase(),
    );
    const key = argAfter(info.argv, '--api-key');
    expect(key).toMatch(/^[0-9a-f]{48}$/);
    expect(argAfter((await infoOf(second)).argv, '--api-key')).not.toBe(key);
  });

  it('passes an explicit layer count and extra args', async () => {
    const sidecar = make();
    await sidecar.start(startOptions({ gpuLayers: 0, extraArgs: ['--flash-attn', 'off'] }));
    const info = await infoOf(sidecar);
    expect(argAfter(info.argv, '-ngl')).toBe('0');
    expect(argAfter(info.argv, '--flash-attn')).toBe('off');
  });

  it('hands the new pid to the guard right after spawn', async () => {
    const job = new FakeProcessJob();
    const sidecar = make({ guard: new JobProcessGuard(job) });
    await sidecar.start(startOptions());
    expect(job.assigned).toEqual([sidecar.pid]);
  });
});

describe('LlamaSidecar API', () => {
  it('requires the API key on /tokenize and chat but not on /health', async () => {
    const sidecar = make();
    await sidecar.start(startOptions());
    const base = `http://127.0.0.1:${portOf(sidecar)}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/tokenize`, { method: 'POST', body: '{}' })).status).toBe(401);
    const wrong = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
      body: '{}',
    });
    expect(wrong.status).toBe(401);
    expect(await sidecar.tokenize('one two three')).toBe(3);
  });

  it('streams content deltas, the finish reason and usage', async () => {
    const sidecar = make();
    await sidecar.start(startOptions());
    const deltas = [];
    for await (const delta of sidecar.chatStream([{ role: 'user', content: 'hi' }], {
      maxTokens: 3,
    })) {
      deltas.push(delta);
    }
    expect(deltas.map((d) => d.content ?? '').join('')).toBe('t0 t1 t2 ');
    expect(deltas.find((d) => d.finishReason)?.finishReason).toBe('stop');
    expect(deltas.find((d) => d.usage)?.usage).toEqual({ promptTokens: 7, completionTokens: 3 });
  });

  it('closes the request when the cancel signal fires mid-stream', async () => {
    const sidecar = make();
    await sidecar.start(startOptions());
    const cancel = new CancelSource();
    let seen = 0;
    const run = (async () => {
      for await (const delta of sidecar.chatStream([{ role: 'user', content: 'hi' }], {
        maxTokens: 500,
        signal: cancel.signal,
      })) {
        if (delta.content !== undefined) seen += 1;
        if (seen === 2) cancel.cancel();
      }
    })();
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    let aborted = 0;
    for (let i = 0; i < 40 && aborted === 0; i++) {
      aborted = (await infoOf(sidecar)).stats.chatAborted;
      if (aborted === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(aborted).toBe(1);
    expect(seen).toBeLessThan(10);
  });

  it('refuses a request before start and after stop', async () => {
    const sidecar = make();
    await expect(sidecar.tokenize('x')).rejects.toMatchObject({ code: 'not-running' });
    await sidecar.start(startOptions());
    await sidecar.stop();
    await expect(sidecar.tokenize('x')).rejects.toMatchObject({ code: 'not-running' });
  });

  it('keeps the API key out of diagnostics', async () => {
    const sidecar = make();
    await sidecar.start(startOptions());
    const key = argAfter((await infoOf(sidecar)).argv, '--api-key');
    expect(sidecar.diagnostics()).not.toContain(key);
  });
});

describe('LlamaSidecar lifetime', () => {
  it('stop kills the process and waits for it', async () => {
    const sidecar = make();
    await sidecar.start(startOptions());
    const pid = sidecar.pid!;
    await sidecar.stop();
    expect(pidAlive(pid)).toBe(false);
    expect(sidecar.isRunning).toBe(false);
  });

  it('stop on a sidecar that never started does nothing', async () => {
    await expect(make().stop()).resolves.toBeUndefined();
  });

  it('restarts once after a crash while idle, then reports the second crash', async () => {
    const sidecar = make();
    await sidecar.start(startOptions());
    const first = sidecar.pid!;
    process.kill(first);
    await waitUntil(() => !pidAlive(first), 5000);
    expect(await sidecar.tokenize('a b')).toBe(2);
    const second = sidecar.pid!;
    expect(second).not.toBe(first);
    process.kill(second);
    await waitUntil(() => !pidAlive(second), 5000);
    await expect(sidecar.tokenize('a b')).rejects.toMatchObject({ code: 'crashed' });
  });

  it('stops after the idle timeout and starts again on the next request', async () => {
    const sidecar = make({ idleTimeoutMs: 300 });
    await sidecar.start(startOptions());
    await sidecar.tokenize('a');
    const first = sidecar.pid!;
    expect(await waitUntil(() => !pidAlive(first), 5000)).toBe(true);
    expect(await sidecar.tokenize('a b c')).toBe(3);
    expect(sidecar.pid).not.toBe(first);
  });

  it('does not idle-stop while a stream is open', async () => {
    const sidecar = make({ idleTimeoutMs: 200 });
    await sidecar.start(startOptions());
    let words = 0;
    for await (const delta of sidecar.chatStream([{ role: 'user', content: 'x' }], {
      maxTokens: 40,
    })) {
      if (delta.content !== undefined) words += 1;
    }
    expect(words).toBe(40);
  });
});
