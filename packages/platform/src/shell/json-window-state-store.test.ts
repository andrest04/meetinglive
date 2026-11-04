import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonWindowStateStore } from './json-window-state-store';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-window-state-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const state = { x: 10, y: 20, width: 1200, height: 800, maximized: true };

describe('JsonWindowStateStore', () => {
  it('returns null when the file does not exist', async () => {
    expect(await new JsonWindowStateStore(path.join(dir, 'window-state.json')).load()).toBeNull();
  });

  it('round trips a state and leaves no temp file', async () => {
    const file = path.join(dir, 'window-state.json');
    const store = new JsonWindowStateStore(file);
    await store.save(state);
    expect(await store.load()).toEqual(state);
    expect(fs.readdirSync(dir)).toEqual(['window-state.json']);
  });

  it('creates the folder on the first save', async () => {
    const file = path.join(dir, 'nested', 'window-state.json');
    await new JsonWindowStateStore(file).save(state);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('treats a corrupt file as empty', async () => {
    const file = path.join(dir, 'window-state.json');
    fs.writeFileSync(file, '{ "x": 1, ');
    expect(await new JsonWindowStateStore(file).load()).toBeNull();
  });

  it('treats a file with the wrong shape as empty', async () => {
    const file = path.join(dir, 'window-state.json');
    fs.writeFileSync(file, JSON.stringify({ x: 0, y: 0, width: 10, height: 10 }));
    expect(await new JsonWindowStateStore(file).load()).toBeNull();
  });

  it('reports a failed save instead of throwing', async () => {
    // A directory where the file should be makes the rename fail.
    const file = path.join(dir, 'window-state.json');
    fs.mkdirSync(file);
    const errors: unknown[] = [];
    const store = new JsonWindowStateStore(file, {
      onError: (error) => errors.push(error),
      retryDelaysMs: [],
    });
    await expect(store.save(state)).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});
