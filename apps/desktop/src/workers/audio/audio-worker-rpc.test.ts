import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AudioWorkerEvent } from '@vozella/contracts';
import { buildWavHeader } from '@vozella/core';
import {
  createNativePorts,
  FakeAudioCapture,
  FakeOsBuild,
  FakeProcessInfo,
  type NativePorts,
} from '@vozella/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAudioWorker } from './audio-worker-core';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-worker-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function setup(ports: NativePorts = createNativePorts({ fake: true })) {
  const events: AudioWorkerEvent[] = [];
  let clock = 0;
  const handle = createAudioWorker({
    createPorts: () => ports,
    post: (e) => events.push(e),
    nowMs: () => clock,
    mainProcessId: 10,
  });
  let id = 0;
  const rpc = async (call: Record<string, unknown>): Promise<AudioWorkerEvent | undefined> => {
    id += 1;
    const mine = id;
    await handle({ type: 'rpc', id: mine, call });
    return events.findLast((e) => e.type === 'rpc-result' && e.id === mine);
  };
  return { events, handle, rpc, tick: (ms: number) => (clock += ms), ports };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('audio worker rpc', () => {
  it('lists microphones and answers failures as a result, never a crash', async () => {
    const { rpc } = setup();
    const ok = await rpc({ method: 'listMicrophones' });
    expect(ok).toMatchObject({ ok: true });
    expect(ok?.type === 'rpc-result' && (ok.result as unknown[]).length).toBe(2);
    const bad = await rpc({
      method: 'importAudio',
      source: path.join(dir, 'no.mp3'),
      destination: path.join(dir, 'o.wav'),
    });
    expect(bad).toMatchObject({ ok: false, message: 'The audio file was not found.' });
  });

  it('records to a file, pushes the mixed frames, the mic level and the end result', async () => {
    const { rpc, events } = setup();
    const target = path.join(dir, 'rec.wav');
    const started = await rpc({
      method: 'recordStart',
      path: target,
      sources: {
        captureMicrophone: true,
        microphoneDeviceId: null,
        output: 'SystemLoopback',
        processId: 0,
      },
    });
    expect(started).toMatchObject({ ok: true });
    await sleep(700);
    await rpc({ method: 'recordPause' });
    await rpc({ method: 'recordResume' });
    const stopped = await rpc({ method: 'recordStop' });
    expect(stopped).toMatchObject({ ok: true });
    expect(fs.statSync(target).size).toBeGreaterThan(46 + 6400);
    expect(events.some((e) => e.type === 'recording-frame')).toBe(true);
    const level = events.find((e) => e.type === 'recording-level');
    expect(level?.type === 'recording-level' && level.level).toBeGreaterThan(0);
  }, 10_000);

  it('stops a running recording on shutdown and finalizes the file (item 47)', async () => {
    const { rpc, handle } = setup();
    const target = path.join(dir, 'shutdown.wav');
    await rpc({
      method: 'recordStart',
      path: target,
      sources: {
        captureMicrophone: false,
        microphoneDeviceId: null,
        output: 'SystemLoopback',
        processId: 0,
      },
    });
    await sleep(300);
    await handle({ type: 'shutdown' });
    const bytes = fs.readFileSync(target);
    expect(bytes.length).toBeGreaterThan(46);
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    // A second shutdown with nothing running does not throw.
    await expect(handle({ type: 'shutdown' })).resolves.toBeUndefined();
  }, 10_000);

  it('answers a refused request with a code the page can map (C7)', async () => {
    const base = createNativePorts({ fake: true });
    const { rpc } = setup({ ...base, osBuild: new FakeOsBuild(19_045) });
    const result = await rpc({
      method: 'recordStart',
      path: path.join(dir, 'rec.wav'),
      sources: {
        captureMicrophone: false,
        microphoneDeviceId: null,
        output: 'ProcessTree',
        processId: 4242,
      },
    });
    expect(result).toMatchObject({ ok: false, code: 'process-loopback-unsupported' });
    expect(fs.existsSync(path.join(dir, 'rec.wav'))).toBe(false);
  });

  it('answers a failed device start as a result and leaves no file (C1)', async () => {
    const base = createNativePorts({ fake: true });
    const { rpc } = setup({ ...base, audio: new FakeAudioCapture({ failWith: 'no device' }) });
    const result = await rpc({
      method: 'recordStart',
      path: path.join(dir, 'rec.wav'),
      sources: {
        captureMicrophone: false,
        microphoneDeviceId: null,
        output: 'SystemLoopback',
        processId: 0,
      },
    });
    expect(result).toMatchObject({ ok: false, message: 'no device' });
    expect(fs.existsSync(path.join(dir, 'rec.wav'))).toBe(false);
  });

  it('throttles idle preview levels to about ten per second, but never swallows zero', async () => {
    const base = createNativePorts({ fake: true });
    const { rpc, events, tick } = setup(base);
    await rpc({ method: 'previewStart', deviceId: 'fake-mic-1' });
    await sleep(300);
    tick(1000);
    await sleep(100);
    await rpc({ method: 'previewStop' });
    const levels = events.filter((e) => e.type === 'preview-level');
    // The fake advances 20 ms per frame while the test clock stands still: only the first
    // frame of each 100 ms window of the test clock gets through.
    expect(levels.length).toBeGreaterThanOrEqual(1);
    expect(levels.length).toBeLessThanOrEqual(3);
  }, 10_000);

  it('returns process details for a pid', async () => {
    const processes = new FakeProcessInfo();
    processes.processes.set(5, {
      processId: 5,
      parentProcessId: 1,
      exePath: 'C:\\a\\x.exe',
      processName: 'x',
      startTimeUtcMs: 1,
    });
    const { rpc } = setup({ ...createNativePorts({ fake: true }), processes });
    expect(await rpc({ method: 'getProcess', processId: 5 })).toMatchObject({
      ok: true,
      result: { processName: 'x' },
    });
    expect(await rpc({ method: 'getProcess', processId: 6 })).toMatchObject({
      ok: true,
      result: null,
    });
  });

  it('cancels an import in flight and removes the partial file', async () => {
    const { rpc } = setup();
    const seconds = 30;
    fs.writeFileSync(
      path.join(dir, 'in.wav'),
      Buffer.concat([buildWavHeader(seconds * 32_000), Buffer.alloc(seconds * 32_000)]),
    );
    const pending = rpc({
      method: 'importAudio',
      source: path.join(dir, 'in.wav'),
      destination: path.join(dir, 'out.wav'),
    });
    await rpc({ method: 'importCancel' });
    expect(await pending).toMatchObject({ ok: false });
    expect(fs.existsSync(path.join(dir, 'out.wav'))).toBe(false);
  });

  it('rejects a malformed rpc without crashing', async () => {
    const { handle, events } = setup();
    await handle({ type: 'rpc', id: 1, call: { method: 'recordStart', path: '' } });
    expect(events).toEqual([{ type: 'error', message: 'invalid command' }]);
  });
});
