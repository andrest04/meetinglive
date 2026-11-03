import { CancelSource, type PinnedFile } from '@vozella/core';
import { describe, expect, it } from 'vitest';
import {
  fakeEngineOptionsFromEnv,
  SteppedModelStore,
  SteppedRuntimeStore,
} from './fake-engine-stores';

const file = { fileName: 'asr.gguf' } as PinnedFile;
const instant = { stepMs: 0, failWith: null, installed: false };

describe('fake engine stores', () => {
  it('reads the three variables and ignores bad values', () => {
    expect(fakeEngineOptionsFromEnv({})).toEqual(instant);
    expect(
      fakeEngineOptionsFromEnv({
        VOZELLA_FAKE_ENGINE_STEP_MS: '40',
        VOZELLA_FAKE_ENGINE_FAIL: 'no network',
        VOZELLA_FAKE_ENGINE_INSTALLED: '1',
      }),
    ).toEqual({ stepMs: 40, failWith: 'no network', installed: true });
    expect(fakeEngineOptionsFromEnv({ VOZELLA_FAKE_ENGINE_STEP_MS: 'x' }).stepMs).toBe(0);
  });

  it('reports 0, 25, 50, 75 and 100 and then has the file', async () => {
    const store = new SteppedModelStore(instant);
    const seen: number[] = [];
    await store.download(file, (p) => seen.push(p));
    expect(seen).toEqual([0, 25, 50, 75, 100]);
    expect(store.isModelDownloaded()).toBe(true);
  });

  it('stops on cancel and leaves nothing installed', async () => {
    const runtimes = new SteppedRuntimeStore(instant);
    const source = new CancelSource();
    await expect(
      runtimes.download(
        'cpu',
        (p) => {
          if (p === 50) source.cancel();
        },
        source.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(runtimes.isReady('cpu')).toBe(false);
  });

  it('fails with the configured message after the steps', async () => {
    const store = new SteppedModelStore({ ...instant, failWith: 'no network' });
    await expect(store.download(file, () => undefined)).rejects.toThrow('no network');
    expect(store.isModelDownloaded()).toBe(false);
  });

  it('starts installed when asked', () => {
    const options = { ...instant, installed: true };
    expect(new SteppedModelStore(options).isModelDownloaded()).toBe(true);
    expect(new SteppedRuntimeStore(options).isReady('cpu')).toBe(true);
  });
});
