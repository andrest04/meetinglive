/**
 * Real-device proof of the audio-capture module. It plays generated tones through the
 * default output (you will hear about ten seconds of a tone), captures them with the Rust
 * addon, and checks the files and events the module produces. It touches no account, no
 * network and no user data.
 *
 *   VOZELLA_REAL_AUDIO=1 pnpm --filter @vozella/platform exec vitest run real-device
 *
 * Needs `pnpm build:native` first and a Windows machine with a default speaker.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  processTreeSources,
  systemLoopbackSources,
  type ActiveAudioApp,
  type SourceLostEvent,
} from '@vozella/core';
import { createNativePorts, type NativePorts } from '../native/create-native-ports';
import { createAudioRuntime, type AudioRuntime } from './audio-runtime';
import { readWavFileInfo } from './wav-files';
import { writeWav } from './wav-test-kit';

const enabled = process.env.VOZELLA_REAL_AUDIO === '1' && process.platform === 'win32';
const here = path.dirname(fileURLToPath(import.meta.url));
const addonPath = path.resolve(
  here,
  '..',
  '..',
  '..',
  '..',
  'native',
  'vozella-native',
  'vozella-native.win32-x64-msvc.node',
);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Peak amplitude (0..1) of one frequency in 16 kHz mono PCM16, by the Goertzel method. */
function toneAmplitude(file: string, hz: number): number {
  const bytes = fs.readFileSync(file).subarray(46);
  const samples = new Int16Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length - (bytes.length % 2)),
  );
  const w = (2 * Math.PI * hz) / 16_000;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (const v of samples) {
    const s = v / 32768 + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const re = s1 - s2 * Math.cos(w);
  const im = s2 * Math.sin(w);
  return (2 * Math.sqrt(re * re + im * im)) / samples.length;
}

describe.skipIf(!enabled)('real devices (VOZELLA_REAL_AUDIO=1)', () => {
  let dir: string;
  let ports: NativePorts;
  let runtime: AudioRuntime;
  const players: ChildProcess[] = [];
  const previewLevels: number[] = [];

  const play = (file: string): ChildProcess => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', `(New-Object System.Media.SoundPlayer "${file}").PlaySync()`],
      { stdio: 'ignore' },
    );
    players.push(child);
    return child;
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-real-audio-'));
    const require = createRequire(import.meta.url);
    ports = createNativePorts({ fake: false, addonPath, load: (p) => require(p) as unknown });
    runtime = createAudioRuntime({
      ports,
      ownProcessId: process.pid,
      onPreviewLevel: (l) => previewLevels.push(l),
    });
    writeWav(path.join(dir, 'a440.wav'), { rate: 44_100, channels: 1, seconds: 25, freq: 440 });
    writeWav(path.join(dir, 'b1000.wav'), { rate: 44_100, channels: 1, seconds: 25, freq: 1000 });
  });

  afterAll(() => {
    for (const p of players) {
      if (p.pid) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('knows the Windows build and lists the microphones with ids and names', () => {
    expect(ports.osBuild.windowsBuild()).toBeGreaterThan(10_000);
    const mics = runtime.listMicrophones();
    for (const m of mics) {
      expect(m.id).not.toBe('');
      expect(m.name).not.toBe('');
    }
  });

  it('records one app tree by pid, excludes another app, and lists the playing apps with meters', async () => {
    // Two tones from two processes at once: the capture of A must hear 440 and not 1000.
    const a = play(path.join(dir, 'a440.wav'));
    play(path.join(dir, 'b1000.wav'));
    await sleep(2500);

    const apps = runtime.refreshApps();
    const names = apps.map((x: ActiveAudioApp) => `${x.friendlyName}#${x.processId}`);
    expect(
      apps.some((x) => x.processId === a.pid),
      `apps: ${names.join(', ')}`,
    ).toBe(true);
    const peaks = runtime.apps.readPeaks();
    expect(peaks.get(a.pid ?? -1) ?? 0).toBeGreaterThan(0);

    const target = path.join(dir, 'procA.wav');
    await runtime.recording.start(target, processTreeSources(false, null, a.pid ?? 0));
    await sleep(4000);
    await runtime.recording.stop();

    const info = readWavFileInfo(target);
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(info.seconds).toBeGreaterThan(3.6);
    expect(info.seconds).toBeLessThan(4.6);
    const own = toneAmplitude(target, 440);
    const other = toneAmplitude(target, 1000);
    expect(own).toBeGreaterThan(0.05);
    expect(other).toBeLessThan(own / 10);
  }, 60_000);

  it('records system audio with the microphone on, mixes them and writes frames like the file', async () => {
    const target = path.join(dir, 'system.wav');
    const frames: number[] = [];
    const lost: SourceLostEvent[] = [];
    runtime.recording.setListeners({
      onFrame: (f) => frames.push(f.samples.length),
      onSourceLost: (e) => lost.push(e),
    });
    await runtime.recording.start(target, systemLoopbackSources(true, null));
    await sleep(3000);
    await runtime.recording.stop();
    const info = readWavFileInfo(target);
    expect(info.seconds).toBeGreaterThan(2.6);
    expect(info.seconds).toBeLessThan(3.6);
    expect(frames.every((n) => n === 3200)).toBe(true);
    expect(frames.length).toBeGreaterThanOrEqual(14);
    expect(toneAmplitude(target, 440) + toneAmplitude(target, 1000)).toBeGreaterThan(0.05);
    expect(lost).toEqual([]);
  }, 60_000);

  it('S1: reports the end of a captured app instead of recording silence', async () => {
    const quick = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 30'], {
      stdio: 'ignore',
    });
    players.push(quick);
    await sleep(1500);
    const target = path.join(dir, 'exit.wav');
    const failures: Error[] = [];
    runtime.recording.setListeners({ onOutputCaptureFailed: (e) => failures.push(e) });
    await runtime.recording.start(target, processTreeSources(false, null, quick.pid ?? 0));
    await sleep(800);
    spawnSync('taskkill', ['/PID', String(quick.pid), '/T', '/F'], { stdio: 'ignore' });
    await sleep(1500);
    expect(failures.map((e) => e.message)).toEqual(['the captured application exited']);
    await expect(runtime.recording.stop()).rejects.toThrow('the captured application exited');
    expect(readWavFileInfo(target).seconds).toBeGreaterThan(0);
  }, 60_000);

  it('previews the microphone level and stops cleanly', async () => {
    await runtime.preview.start(null);
    await sleep(800);
    runtime.preview.stop();
    // A silent room still yields levels (zero is a level); no throw is the proof.
    expect(previewLevels.every((l) => l >= 0 && l <= 1)).toBe(true);
  }, 20_000);

  it('imports a 44.1 kHz stereo file through Media Foundation as 16 kHz mono', async () => {
    writeWav(path.join(dir, 'in.wav'), { rate: 44_100, channels: 2, seconds: 3 });
    const out = path.join(dir, 'imported.wav');
    await runtime.importAudio(path.join(dir, 'in.wav'), out);
    const info = readWavFileInfo(out);
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(Math.abs(info.seconds - 3)).toBeLessThan(0.05);
    expect(toneAmplitude(out, 440)).toBeGreaterThan(0.2);
  });

  it('refuses a file Media Foundation cannot decode and leaves nothing behind', async () => {
    fs.writeFileSync(path.join(dir, 'junk.mp3'), 'not audio');
    const out = path.join(dir, 'junk.wav');
    await expect(runtime.importAudio(path.join(dir, 'junk.mp3'), out)).rejects.toThrow();
    expect(fs.existsSync(out)).toBe(false);
  });
});
