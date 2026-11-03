import type { AudioWorkerCommand } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioWorkerHost } from './audio-worker-host';
import type { WorkerProcess } from './managed-worker';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** A scripted worker: answers like the real audio worker would. */
class ScriptedProcess implements WorkerProcess {
  commands: AudioWorkerCommand[] = [];
  private message: (m: unknown) => void = () => undefined;
  private exitFn: (code: number) => void = () => undefined;
  constructor(
    private readonly behaviour: { startError?: string; pingError?: string; silent?: boolean } = {},
  ) {}
  postMessage(raw: unknown): void {
    const command = raw as AudioWorkerCommand;
    this.commands.push(command);
    if (this.behaviour.silent) return;
    queueMicrotask(() => {
      if (command.type === 'ping' && this.behaviour.pingError) {
        this.message({ type: 'error', message: this.behaviour.pingError });
      } else if (command.type === 'ping') {
        this.message({ type: 'pong', backend: 'fake', platformSupported: true });
      } else if (command.type === 'start') {
        if (this.behaviour.startError) {
          this.message({ type: 'error', message: this.behaviour.startError });
        } else {
          this.message({ type: 'started' });
        }
      } else if (command.type === 'shutdown') {
        this.exitFn(0);
      } else {
        this.message({
          type: 'stopped',
          stats: {
            frames: 2,
            realSamples: 640,
            synthesizedSamples: 0,
            packets: 2,
            silentFlagPackets: 0,
            discontinuities: 0,
          },
        });
      }
    });
  }
  frame(tsMs: number): void {
    this.message({ type: 'frame', pcm: new Uint8Array(640), tsMs, synthesized: false });
  }
  raw(m: unknown): void {
    this.message(m);
  }
  onMessage(l: (m: unknown) => void): void {
    this.message = l;
  }
  onExit(l: (code: number) => void): void {
    this.exitFn = l;
  }
  kill(): void {
    this.exitFn(1);
  }
  crash(): void {
    this.exitFn(1);
  }
}

function make(behaviours: ConstructorParameters<typeof ScriptedProcess>[0][] = [{}]) {
  const procs: ScriptedProcess[] = [];
  const host = new AudioWorkerHost({
    logger,
    requestTimeoutMs: 1000,
    spawn: () => {
      const p = new ScriptedProcess(behaviours[Math.min(procs.length, behaviours.length - 1)]);
      procs.push(p);
      return p;
    },
  });
  return { host, procs };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AudioWorkerHost', () => {
  it('starts lazily and answers ping', async () => {
    const { host, procs } = make();
    expect(procs).toHaveLength(0);
    await expect(host.ping()).resolves.toEqual({ backend: 'fake', platformSupported: true });
    expect(procs).toHaveLength(1);
  });

  it('streams frames to the listener and returns stats on stop', async () => {
    const { host, procs } = make();
    const onFrame = vi.fn();
    await host.startCapture({ kind: 'mic' }, { onFrame });
    procs[0]?.frame(0);
    procs[0]?.frame(20);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onFrame.mock.calls[1]?.[0]).toMatchObject({ tsMs: 20, synthesized: false });
    await expect(host.stopCapture()).resolves.toMatchObject({ frames: 2 });
  });

  it('rejects a second capture while one is active', async () => {
    const { host } = make();
    await host.startCapture({ kind: 'mic' }, { onFrame: vi.fn() });
    await expect(host.startCapture({ kind: 'system' }, { onFrame: vi.fn() })).rejects.toThrow(
      /already running/,
    );
  });

  it('surfaces a device error from start and allows trying again', async () => {
    const { host } = make([{ startError: 'no device' }]);
    await expect(host.startCapture({ kind: 'mic' }, { onFrame: vi.fn() })).rejects.toThrow(
      'no device',
    );
    await expect(host.startCapture({ kind: 'mic' }, { onFrame: vi.fn() })).rejects.toThrow(
      'no device',
    );
  });

  it('rejects ping with the worker error instead of waiting for the timeout', async () => {
    const { host } = make([{ pingError: 'addon missing' }]);
    await expect(host.ping()).rejects.toThrow('addon missing');
  });

  it('times out when the worker is silent', async () => {
    const { host } = make([{ silent: true }]);
    const result = host.ping();
    const assertion = expect(result).rejects.toThrow(/in time/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('drops invalid messages without disturbing the capture', async () => {
    const { host, procs } = make();
    const onFrame = vi.fn();
    await host.startCapture({ kind: 'mic' }, { onFrame });
    procs[0]?.raw({ type: 'frame', pcm: 'not bytes', tsMs: 0, synthesized: false });
    procs[0]?.raw({ type: 'nonsense' });
    expect(onFrame).not.toHaveBeenCalled();
    procs[0]?.frame(0);
    expect(onFrame).toHaveBeenCalledOnce();
  });

  it('resumes an active capture on a restarted worker', async () => {
    const { host, procs } = make();
    const onFrame = vi.fn();
    await host.startCapture({ kind: 'process', pid: 99, includeTree: true }, { onFrame });
    procs[0]?.crash();
    await vi.advanceTimersByTimeAsync(200);
    expect(procs).toHaveLength(2);
    expect(procs[1]?.commands).toEqual([
      { type: 'start', source: { kind: 'process', pid: 99, includeTree: true } },
    ]);
    procs[1]?.frame(0);
    expect(onFrame).toHaveBeenCalledOnce();
  });

  it('stops the worker on dispose', async () => {
    const { host, procs } = make();
    await host.ping();
    await host.dispose();
    expect(procs[0]?.commands.at(-1)).toEqual({ type: 'shutdown' });
    expect(host.state).toBe('stopped');
  });
});
