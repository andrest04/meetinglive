import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CancelSource, processTreeSources, systemLoopbackSources } from '@vozella/core';
import { FakeAudioCapture } from '../fakes/fake-audio-capture';
import { FakeOsBuild } from '../fakes/fake-audio-devices';
import { createNativePorts, type NativePorts } from '../native/create-native-ports';
import { createAudioRuntime } from './audio-runtime';
import { writeWav } from './wav-test-kit';
import { readWavFileInfo } from './wav-files';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-audio-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runtimeWith(overrides: Partial<NativePorts> = {}) {
  const ports: NativePorts = { ...createNativePorts({ fake: true }), ...overrides };
  const levels: number[] = [];
  const runtime = createAudioRuntime({
    ports,
    ownProcessId: 1,
    onPreviewLevel: (l) => levels.push(l),
  });
  return { runtime, ports, levels };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('recording through the runtime', () => {
  it('writes a readable 16 kHz mono file whose length tracks the clock', async () => {
    const { runtime } = runtimeWith();
    const target = path.join(dir, 'rec.wav');
    await runtime.recording.start(target, systemLoopbackSources(true, null));
    await sleep(1300);
    await runtime.recording.stop();
    const info = readWavFileInfo(target);
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    // 1.3 s of wall time: chunks of 0.2 s, the first one written at once.
    expect(info.seconds).toBeGreaterThanOrEqual(1.2);
    expect(info.seconds).toBeLessThanOrEqual(1.8);
  }, 10_000);

  it('does not record the break', async () => {
    const { runtime } = runtimeWith();
    const target = path.join(dir, 'rec.wav');
    await runtime.recording.start(target, systemLoopbackSources(false, null));
    await sleep(500);
    runtime.recording.pause();
    await sleep(1000);
    runtime.recording.resume();
    await sleep(500);
    await runtime.recording.stop();
    expect(readWavFileInfo(target).seconds).toBeLessThan(1.6);
  }, 10_000);

  it('C1: a failed start leaves no file behind', async () => {
    const { runtime } = runtimeWith({ audio: new FakeAudioCapture({ failWith: 'no device' }) });
    const target = path.join(dir, 'rec.wav');
    await expect(
      runtime.recording.start(target, systemLoopbackSources(true, null)),
    ).rejects.toThrow('no device');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('C7: a process capture on an old Windows says what is wrong, before any file exists', async () => {
    const { runtime } = runtimeWith({ osBuild: new FakeOsBuild(19_045) });
    const target = path.join(dir, 'rec.wav');
    await expect(
      runtime.recording.start(target, processTreeSources(true, null, 4242)),
    ).rejects.toMatchObject({ code: 'process-loopback-unsupported' });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('keeps a header-repairable file when the writer cannot flush at stop', async () => {
    // A recording killed mid-way: the file on disk has a zero header and is repaired.
    const { runtime } = runtimeWith();
    const target = path.join(dir, 'rec.wav');
    await runtime.recording.start(target, systemLoopbackSources(false, null));
    await sleep(400);
    fs.copyFileSync(target, path.join(dir, 'crashed.wav'));
    await runtime.recording.stop();
    const { repairWavFile, readWavDurationSeconds } = await import('./wav-files');
    expect(repairWavFile(path.join(dir, 'crashed.wav'))).toBe('Repaired');
    expect(readWavDurationSeconds(path.join(dir, 'crashed.wav'))).toBeGreaterThan(0);
  }, 10_000);
});

describe('import through the runtime', () => {
  it('converts stereo 44.1 kHz to 16 kHz mono PCM16 keeping the duration within 50 ms', async () => {
    const { runtime } = runtimeWith();
    writeWav(path.join(dir, 'in.wav'), { rate: 44_100, channels: 2, seconds: 3 });
    const out = path.join(dir, 'nested', 'out.wav');
    await runtime.importAudio(path.join(dir, 'in.wav'), out);
    const info = readWavFileInfo(out);
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(Math.abs(info.seconds - 3)).toBeLessThan(0.05);
  });

  it('yields a valid file for audio that is already 16 kHz mono', async () => {
    const { runtime } = runtimeWith();
    writeWav(path.join(dir, 'in.wav'), { rate: 16_000, channels: 1, seconds: 1 });
    await runtime.importAudio(path.join(dir, 'in.wav'), path.join(dir, 'out.wav'));
    expect(readWavFileInfo(path.join(dir, 'out.wav')).seconds).toBeGreaterThan(0.9);
  });

  it('C2: a 6 channel source comes out mono', async () => {
    const { runtime } = runtimeWith();
    writeWav(path.join(dir, 'in.wav'), { rate: 48_000, channels: 6, seconds: 1 });
    await runtime.importAudio(path.join(dir, 'in.wav'), path.join(dir, 'out.wav'));
    expect(readWavFileInfo(path.join(dir, 'out.wav')).channels).toBe(1);
  });

  it('throws file not found for a missing source and creates nothing', async () => {
    const { runtime } = runtimeWith();
    await expect(
      runtime.importAudio(path.join(dir, 'missing.mp3'), path.join(dir, 'out.wav')),
    ).rejects.toThrow('The audio file was not found.');
    expect(fs.existsSync(path.join(dir, 'out.wav'))).toBe(false);
  });

  it('throws for non-audio bytes and leaves no WAV', async () => {
    const { runtime } = runtimeWith();
    fs.writeFileSync(path.join(dir, 'in.mp3'), 'not audio');
    await expect(
      runtime.importAudio(path.join(dir, 'in.mp3'), path.join(dir, 'out.wav')),
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, 'out.wav'))).toBe(false);
  });

  it('stops between buffers when cancelled and removes the partial file', async () => {
    const { runtime } = runtimeWith();
    writeWav(path.join(dir, 'in.wav'), { rate: 16_000, channels: 1, seconds: 20 });
    const cancel = new CancelSource();
    const pending = runtime.importAudio(
      path.join(dir, 'in.wav'),
      path.join(dir, 'out.wav'),
      cancel,
    );
    cancel.cancel();
    await expect(pending).rejects.toThrow('cancelled');
    expect(fs.existsSync(path.join(dir, 'out.wav'))).toBe(false);
  });
});

describe('microphones', () => {
  it('lists the devices, and an unreadable list gives an empty one', () => {
    const { runtime } = runtimeWith();
    expect(runtime.listMicrophones().map((d) => d.name)).toEqual([
      'Test microphone',
      'Test headset',
    ]);
    const broken = runtimeWith({
      microphones: {
        list: () => {
          throw new Error('endpoint failed');
        },
      },
    });
    expect(broken.runtime.listMicrophones()).toEqual([]);
  });
});
