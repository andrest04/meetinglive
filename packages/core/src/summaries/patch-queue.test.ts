import { describe, expect, it } from 'vitest';
import { PatchQueue } from './patch-queue';

/** Waits n microtask turns; core has no timer types. */
const tick = async (turns: number): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

describe('PatchQueue (B5)', () => {
  it('runs tasks of one key in order even when earlier ones are slower', async () => {
    const queue = new PatchQueue();
    const order: number[] = [];
    const jobs = [30, 1, 15, 0].map((delay, i) =>
      queue.run('m', async () => {
        await tick(delay);
        order.push(i);
        return i;
      }),
    );
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('a failing task rejects only itself and the next still runs', async () => {
    const queue = new PatchQueue();
    const a = queue.run('m', () => Promise.reject(new Error('disk full')));
    const b = queue.run('m', () => Promise.resolve('ok'));
    await expect(a).rejects.toThrow('disk full');
    await expect(b).resolves.toBe('ok');
  });

  it('different keys do not wait for each other', async () => {
    const queue = new PatchQueue();
    let release: () => void = () => undefined;
    const slow = queue.run('a', () => new Promise<void>((r) => (release = r)));
    await expect(queue.run('b', () => Promise.resolve(1))).resolves.toBe(1);
    release();
    await slow;
  });

  it('forgets idle keys', async () => {
    const queue = new PatchQueue();
    await queue.run('m', () => Promise.resolve());
    await tick(0);
    expect(queue.pendingKeys).toBe(0);
  });
});
