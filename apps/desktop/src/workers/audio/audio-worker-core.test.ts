import type { AudioWorkerEvent } from '@vozella/contracts';
import { createNativePorts, FakeAudioCapture, type NativePorts } from '@vozella/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioWorker } from './audio-worker-core';

function setup(createPorts: () => NativePorts = () => createNativePorts({ fake: true })) {
  const events: AudioWorkerEvent[] = [];
  const handle = createAudioWorker({ createPorts, post: (e) => events.push(e) });
  return { events, handle };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('audio worker core', () => {
  it('answers ping with the backend and builds ports lazily', async () => {
    const createPorts = vi.fn(() => createNativePorts({ fake: true }));
    const { events, handle } = setup(createPorts);
    expect(createPorts).not.toHaveBeenCalled();
    await handle({ type: 'ping' });
    expect(events).toEqual([{ type: 'pong', backend: 'fake', platformSupported: true }]);
  });

  it('captures frames then reports stats on stop', async () => {
    const { events, handle } = setup();
    await handle({ type: 'start', source: { kind: 'mic' } });
    await vi.advanceTimersByTimeAsync(100);
    await handle({ type: 'stop' });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('started');
    expect(types.filter((t) => t === 'frame').length).toBeGreaterThanOrEqual(4);
    const stopped = events.at(-1);
    expect(stopped?.type).toBe('stopped');
    if (stopped?.type === 'stopped') expect(stopped.stats.frames).toBeGreaterThanOrEqual(4);
  });

  it('refuses a second start', async () => {
    const { events, handle } = setup();
    await handle({ type: 'start', source: { kind: 'mic' } });
    await handle({ type: 'start', source: { kind: 'system' } });
    expect(events.at(-1)).toEqual({ type: 'error', message: 'capture already running' });
    await handle({ type: 'stop' });
  });

  it('reports a device failure as an error event', async () => {
    const ports: NativePorts = {
      ...createNativePorts({ fake: true }),
      audio: new FakeAudioCapture({ failWith: 'no device' }),
    };
    const { events, handle } = setup(() => ports);
    await handle({ type: 'start', source: { kind: 'mic' } });
    expect(events).toEqual([{ type: 'error', message: 'no device' }]);
  });

  it('reports a missing addon as an error event, not a crash', async () => {
    const { events, handle } = setup(() => {
      throw new Error('addon missing');
    });
    await handle({ type: 'ping' });
    expect(events).toEqual([{ type: 'error', message: 'addon missing' }]);
  });

  it('rejects invalid commands', async () => {
    const { events, handle } = setup();
    await handle({ type: 'start', source: { kind: 'process', pid: -1 } });
    await handle('nope');
    expect(events).toEqual([
      { type: 'error', message: 'invalid command' },
      { type: 'error', message: 'invalid command' },
    ]);
  });

  it('stop without a capture still answers', async () => {
    const { events, handle } = setup();
    await handle({ type: 'stop' });
    expect(events[0]).toMatchObject({ type: 'stopped', stats: { frames: 0 } });
  });
});
