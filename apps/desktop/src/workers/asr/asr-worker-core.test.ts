import type { AsrWorkerEvent } from '@vozella/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAsrWorker, type KoffiLike } from './asr-worker-core';

const koffi = (version = '3.3.6', answer: unknown = 'nemo 0.3.0'): KoffiLike => ({
  version,
  load: () => ({ func: () => () => answer }),
});

function setup(loader: () => Promise<KoffiLike>) {
  const events: AsrWorkerEvent[] = [];
  const prepareDllDirectory = vi.fn();
  const handle = createAsrWorker({
    loadKoffi: loader,
    prepareDllDirectory,
    join: (...p) => p.join('/'),
    post: (e) => events.push(e),
  });
  return { events, handle, prepareDllDirectory };
}

describe('asr worker core', () => {
  it('reports the koffi version on ping', async () => {
    const { events, handle } = setup(() => Promise.resolve(koffi()));
    await handle({ type: 'ping' });
    expect(events).toEqual([{ type: 'pong', koffi: '3.3.6' }]);
  });

  it('reports a broken koffi as null instead of crashing', async () => {
    const { events, handle } = setup(() => Promise.reject(new Error('cannot find module')));
    await handle({ type: 'ping' });
    expect(events).toEqual([{ type: 'pong', koffi: null }]);
  });

  it('loads the engine from the given folder and reports its version', async () => {
    const { events, handle, prepareDllDirectory } = setup(() => Promise.resolve(koffi()));
    await handle({ type: 'load', binDir: 'C:/engine' });
    expect(prepareDllDirectory).toHaveBeenCalledWith('C:/engine', expect.anything());
    expect(events).toEqual([{ type: 'loaded', version: 'nemo 0.3.0' }]);
  });

  it('reports load failures as error events', async () => {
    const failing: KoffiLike = {
      version: '3',
      load: () => {
        throw new Error('Cannot find shared library');
      },
    };
    const { events, handle } = setup(() => Promise.resolve(failing));
    await handle({ type: 'load', binDir: 'C:/nope' });
    expect(events).toEqual([{ type: 'error', message: 'Cannot find shared library' }]);
  });

  it('rejects invalid commands', async () => {
    const { events, handle } = setup(() => Promise.resolve(koffi()));
    await handle({ type: 'load' });
    expect(events).toEqual([{ type: 'error', message: 'invalid command' }]);
  });
});
