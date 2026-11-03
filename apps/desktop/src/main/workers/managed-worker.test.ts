import type { Logger } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedWorker, type WorkerProcess, type WorkerState } from './managed-worker';

class FakeProcess implements WorkerProcess {
  sent: unknown[] = [];
  killed = false;
  private messageListener: (m: unknown) => void = () => undefined;
  private exitListener: (code: number) => void = () => undefined;
  constructor(private readonly exitOnStop: boolean) {}
  postMessage(message: unknown): void {
    this.sent.push(message);
    if (this.exitOnStop && (message as { type?: string }).type === 'shutdown') this.exit(0);
  }
  onMessage(listener: (m: unknown) => void): void {
    this.messageListener = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exitListener = listener;
  }
  kill(): void {
    this.killed = true;
    this.exit(1);
  }
  emit(message: unknown): void {
    this.messageListener(message);
  }
  exit(code: number): void {
    this.exitListener(code);
  }
}

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function setup(options: { exitOnStop?: boolean; maxRestarts?: number } = {}) {
  const procs: FakeProcess[] = [];
  const states: WorkerState[] = [];
  const onMessage = vi.fn();
  const onRestarted = vi.fn();
  const worker = new ManagedWorker({
    name: 'test',
    logger,
    spawn: () => {
      const p = new FakeProcess(options.exitOnStop ?? true);
      procs.push(p);
      return p;
    },
    onMessage,
    onRestarted,
    onStateChange: (s) => states.push(s),
    maxRestarts: options.maxRestarts ?? 3,
    backoffMs: () => 100,
    stopTimeoutMs: 500,
  });
  return { worker, procs, states, onMessage, onRestarted };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ManagedWorker', () => {
  it('starts, forwards messages and sends commands', () => {
    const { worker, procs, onMessage } = setup();
    worker.start();
    expect(worker.state).toBe('running');
    procs[0]?.emit({ type: 'pong' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'pong' });
    worker.send({ type: 'ping' });
    expect(procs[0]?.sent).toEqual([{ type: 'ping' }]);
  });

  it('refuses to send when not running', () => {
    const { worker } = setup();
    expect(() => {
      worker.send({});
    }).toThrow(/not running/);
  });

  it('restarts after a crash with backoff and tells the owner', () => {
    const { worker, procs, onRestarted, states } = setup();
    worker.start();
    procs[0]?.exit(1);
    expect(worker.state).toBe('restarting');
    expect(procs).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(procs).toHaveLength(2);
    expect(worker.state).toBe('running');
    expect(onRestarted).toHaveBeenCalledOnce();
    expect(states).toEqual(['running', 'restarting', 'running']);
  });

  it('ignores messages from a dead process', () => {
    const { worker, procs, onMessage } = setup();
    worker.start();
    procs[0]?.exit(1);
    vi.advanceTimersByTime(100);
    procs[0]?.emit({ stale: true });
    expect(onMessage).not.toHaveBeenCalled();
    expect(worker.state).toBe('running');
  });

  it('gives up after too many crashes in the window', () => {
    const { worker, procs } = setup({ maxRestarts: 2 });
    worker.start();
    for (let i = 0; i < 3; i += 1) {
      procs[i]?.exit(1);
      vi.advanceTimersByTime(100);
    }
    expect(worker.state).toBe('failed');
    expect(procs).toHaveLength(3);
  });

  it('stops cleanly and does not restart', async () => {
    const { worker, procs } = setup();
    worker.start();
    await worker.stop();
    expect(worker.state).toBe('stopped');
    expect(procs[0]?.sent).toEqual([{ type: 'shutdown' }]);
    vi.advanceTimersByTime(10_000);
    expect(procs).toHaveLength(1);
  });

  it('kills a worker that ignores stop', async () => {
    const { worker, procs } = setup({ exitOnStop: false });
    worker.start();
    const stopping = worker.stop();
    vi.advanceTimersByTime(500);
    await stopping;
    expect(procs[0]?.killed).toBe(true);
    expect(worker.state).toBe('stopped');
  });

  it('cancels a pending restart when stopped', async () => {
    const { worker, procs } = setup();
    worker.start();
    procs[0]?.exit(1);
    await worker.stop();
    vi.advanceTimersByTime(1000);
    expect(procs).toHaveLength(1);
    expect(worker.state).toBe('stopped');
  });
});
