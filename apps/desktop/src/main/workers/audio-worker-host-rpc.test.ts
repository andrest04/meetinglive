import type { AudioWorkerCommand } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRpcError, AudioWorkerHost, type AudioPushEvent } from './audio-worker-host';
import type { WorkerProcess } from './managed-worker';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

class RpcProcess implements WorkerProcess {
  commands: AudioWorkerCommand[] = [];
  private message: (m: unknown) => void = () => undefined;
  private exitFn: (code: number) => void = () => undefined;
  /** When set, replies to rpc calls with this; undefined stays silent. */
  reply: ((command: Extract<AudioWorkerCommand, { type: 'rpc' }>) => unknown) | undefined;
  postMessage(raw: unknown): void {
    const command = raw as AudioWorkerCommand;
    this.commands.push(command);
    if (command.type === 'rpc' && this.reply) {
      const answer = this.reply(command);
      queueMicrotask(() => {
        this.message(answer);
      });
    } else if (command.type === 'shutdown') {
      queueMicrotask(() => {
        this.exitFn(0);
      });
    }
  }
  push(m: unknown): void {
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

function make() {
  const procs: RpcProcess[] = [];
  const host = new AudioWorkerHost({
    logger,
    requestTimeoutMs: 1000,
    spawn: () => {
      const p = new RpcProcess();
      p.reply = (c) => ({
        type: 'rpc-result',
        id: c.id,
        ok: true,
        result: { echo: c.call.method },
      });
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

describe('AudioWorkerHost.call', () => {
  it('sends the call with an id and resolves with the result', async () => {
    const { host, procs } = make();
    await expect(host.call({ method: 'listMicrophones' })).resolves.toEqual({
      echo: 'listMicrophones',
    });
    expect(procs[0]?.commands[0]).toEqual({
      type: 'rpc',
      id: 1,
      call: { method: 'listMicrophones' },
    });
  });

  it('matches concurrent answers to their calls', async () => {
    const { host, procs } = make();
    await host.call({ method: 'listMicrophones' });
    procs[0]!.reply = undefined;
    const a = host.call({ method: 'appsRefresh' });
    const b = host.call({ method: 'appsPeaks' });
    procs[0]?.push({ type: 'rpc-result', id: 3, ok: true, result: 'b' });
    procs[0]?.push({ type: 'rpc-result', id: 2, ok: true, result: 'a' });
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
  });

  it('rejects with the message and code of a failed call', async () => {
    const { host, procs } = make();
    await host.call({ method: 'listMicrophones' });
    procs[0]!.reply = (c) => ({
      type: 'rpc-result',
      id: c.id,
      ok: false,
      message: 'needs a newer Windows',
      code: 'process-loopback-unsupported',
    });
    const error = await host
      .call({ method: 'recordStart', path: 'a.wav', sources: sources() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioRpcError);
    expect(error).toMatchObject({
      message: 'needs a newer Windows',
      code: 'process-loopback-unsupported',
    });
  });

  it('times out a silent worker, and a zero timeout waits as long as the work takes', async () => {
    const { host, procs } = make();
    await host.call({ method: 'listMicrophones' });
    procs[0]!.reply = undefined;
    const quick = host.call({ method: 'appsRefresh' }, 500);
    const assertion = expect(quick).rejects.toThrow(/did not answer appsRefresh in time/);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;

    const long = host.call({ method: 'importAudio', source: 'a.mp3', destination: 'b.wav' }, 0);
    let settled = false;
    void long.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
    procs[0]?.push({ type: 'rpc-result', id: 3, ok: true, result: null });
    await long;
  });

  it('delivers pushed events to subscribers until they unsubscribe', async () => {
    const { host, procs } = make();
    await host.call({ method: 'listMicrophones' });
    const seen: AudioPushEvent[] = [];
    const off = host.onPush((e) => seen.push(e));
    procs[0]?.push({ type: 'preview-level', level: 40 });
    procs[0]?.push({ type: 'source-lost', source: 'Microphone', remaining: 1, message: 'gone' });
    off();
    procs[0]?.push({ type: 'preview-level', level: 50 });
    expect(seen.map((e) => e.type)).toEqual(['preview-level', 'source-lost']);
  });

  it('a throwing subscriber does not block the others', async () => {
    const { host, procs } = make();
    await host.call({ method: 'listMicrophones' });
    const seen: unknown[] = [];
    host.onPush(() => {
      throw new Error('listener failed');
    });
    host.onPush((e) => seen.push(e));
    procs[0]?.push({ type: 'recording-level', level: 10 });
    expect(seen).toHaveLength(1);
  });

  it('tells subscribers when the worker dies during a recording, and fails pending calls', async () => {
    const { host, procs } = make();
    await host.call({ method: 'recordStart', path: 'a.wav', sources: sources() });
    procs[0]!.reply = undefined;
    const pending = host.call({ method: 'recordPause' });
    const seen: AudioPushEvent[] = [];
    host.onPush((e) => seen.push(e));
    const assertion = expect(pending).rejects.toThrow(/restarted/);
    procs[0]?.crash();
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(seen).toEqual([expect.objectContaining({ type: 'faulted' })]);
    expect(procs).toHaveLength(2);
  });

  it('does not report a fault after a clean stop', async () => {
    const { host, procs } = make();
    await host.call({ method: 'recordStart', path: 'a.wav', sources: sources() });
    await host.call({ method: 'recordStop' });
    const seen: AudioPushEvent[] = [];
    host.onPush((e) => seen.push(e));
    procs[0]?.crash();
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toEqual([]);
  });
});

function sources() {
  return {
    captureMicrophone: true,
    microphoneDeviceId: null,
    output: 'SystemLoopback' as const,
    processId: 0,
  };
}
