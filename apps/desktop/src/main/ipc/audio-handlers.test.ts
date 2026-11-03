import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestChannels, type RequestName } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioController } from '../audio/audio-controller';
import type { RecordingTakes } from '../audio/recording-take';
import type { IpcEventLike } from '../security/trusted-origin';
import { registerAudioHandlers } from './audio-handlers';
import type { IpcMainLike } from './ipc-server';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-audio-handlers-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const state = {
  cards: [{ processId: null, app: null, isAvailable: true, level: 0 }],
  selectedProcessId: null,
  noAppsPlaying: true,
  suggestion: null,
  fallbackAppName: null,
};

function setup(pick: string | null = null) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const controller = {
    pendingNotices: [{ kind: 'faulted', message: 'disk full' }],
    loadMicrophones: vi.fn(() =>
      Promise.resolve({
        options: [{ kind: 'None', deviceId: null, name: null }],
        selected: { kind: 'None', deviceId: null },
      }),
    ),
    rememberMicrophone: vi.fn(() => Promise.resolve(true)),
    startSources: vi.fn(() => Promise.resolve(state)),
    stopSources: vi.fn(),
    select: vi.fn(() => Promise.resolve(state)),
    dismissSuggestion: vi.fn(() => state),
    closeFallback: vi.fn(() => state),
    startPreview: vi.fn(),
    stopPreview: vi.fn(),
  };
  const takes = {
    start: vi.fn(() => Promise.resolve({ started: true as const, recordedAtMs: 9 })),
    pause: vi.fn(() => Promise.resolve(true)),
    resume: vi.fn(() => Promise.resolve(true)),
    stop: vi.fn(() =>
      Promise.resolve({ path: 'a.wav', recordedAtMs: 9, pausedSeconds: 2, error: null }),
    ),
    rememberPick: vi.fn(),
    importPicked: vi.fn(() =>
      Promise.resolve({
        imported: true as const,
        path: 'a.wav',
        recordedAtMs: 1,
        endedAtMs: 2,
        durationSeconds: 0.001,
      }),
    ),
  };
  const appIcon = vi.fn((_: string) =>
    Promise.resolve<string | null>('data:image/png;base64,AA=='),
  );
  const pickAudioFile = vi.fn((_: readonly string[]) => Promise.resolve(pick));
  registerAudioHandlers({
    server: { ipc, logger: logger(), isTrusted: () => true },
    controller: controller as unknown as AudioController,
    takes: takes as unknown as RecordingTakes,
    appIcon,
    pickAudioFile,
    nowMs: () => 5_000,
  });
  const call = async (name: RequestName, input: unknown): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    return handler(event as never, input);
  };
  return { call, controller, takes, appIcon, pickAudioFile, handlers };
}

describe('audio handlers', () => {
  it('registers every audio request channel', () => {
    const { handlers } = setup();
    const audioChannels = Object.keys(requestChannels).filter((n) => n.startsWith('audio.'));
    expect(audioChannels.sort()).toEqual([...handlers.keys()].sort());
  });

  it('loads microphones with the user choice', async () => {
    const { call, controller } = setup();
    const result = await call('audio.microphones.load', { userChoice: null });
    expect(result).toMatchObject({ ok: true, value: { selected: { kind: 'None' } } });
    expect(controller.loadMicrophones).toHaveBeenCalledWith(null);
  });

  it('rejects an unknown microphone kind at the contract', async () => {
    const { call, controller } = setup();
    const result = await call('audio.microphones.remember', {
      choice: { kind: 'Everything', deviceId: null },
    });
    expect(result).toMatchObject({ ok: false });
    expect(controller.rememberMicrophone).not.toHaveBeenCalled();
  });

  it('starts, selects, dismisses and stops the picker', async () => {
    const { call, controller } = setup();
    expect(await call('audio.sources.start', {})).toMatchObject({ ok: true });
    await call('audio.sources.select', { processId: 7 });
    await call('audio.sources.dismissSuggestion', { processId: 7 });
    await call('audio.sources.closeFallback', {});
    expect(await call('audio.sources.stop', {})).toMatchObject({ ok: true });
    expect(controller.select).toHaveBeenCalledWith(7);
    expect(controller.stopSources).toHaveBeenCalledOnce();
  });

  it('starts and stops the preview', async () => {
    const { call, controller } = setup();
    await call('audio.preview.start', { deviceId: null });
    await call('audio.preview.stop', {});
    expect(controller.startPreview).toHaveBeenCalledWith(null, 'settings');
    expect(controller.stopPreview).toHaveBeenCalledOnce();
  });

  it('offers the import extensions and returns the last-write time of the picked file', async () => {
    const file = path.join(dir, 'talk.mp3');
    fs.writeFileSync(file, 'x');
    fs.utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const { call, pickAudioFile } = setup(file);
    const result = await call('audio.import.pickFile', {});
    expect(pickAudioFile.mock.calls[0]?.[0]).toEqual([
      '.wav',
      '.mp3',
      '.m4a',
      '.aac',
      '.flac',
      '.wma',
      '.3gp',
      '.mp4',
    ]);
    expect(result).toMatchObject({
      ok: true,
      value: { path: file, recordedAtMs: 1_700_000_000_000 },
    });
  });

  it('uses now when the file time cannot be read, and null when cancelled', async () => {
    const missing = setup(path.join(dir, 'gone.mp3'));
    expect(await missing.call('audio.import.pickFile', {})).toMatchObject({
      value: { recordedAtMs: 5_000 },
    });
    const cancelled = setup(null);
    expect(await cancelled.call('audio.import.pickFile', {})).toMatchObject({ value: null });
  });

  it('remembers the pick in main and never lets the page name the file to convert', async () => {
    const file = path.join(dir, 'talk.mp3');
    fs.writeFileSync(file, 'x');
    const { call, takes } = setup(file);
    await call('audio.import.pickFile', {});
    expect(takes.rememberPick).toHaveBeenCalledWith({
      path: file,
      recordedAtMs: expect.any(Number) as number,
    });
    const run = await call('audio.import.run', { title: 'Call' });
    expect(run).toMatchObject({ ok: true, value: { imported: true } });
    expect(takes.importPicked).toHaveBeenCalledWith('Call');
    const smuggled = await call('audio.import.run', {
      title: 'x',
      path: String.raw`C:\secret.wav`,
    });
    expect(smuggled).toMatchObject({ ok: true });
  });

  it('forgets an earlier pick when the dialog is cancelled', async () => {
    const { call, takes } = setup(null);
    await call('audio.import.pickFile', {});
    expect(takes.rememberPick).toHaveBeenCalledWith(null);
  });

  it('reports where the take stands and starts no preview while a take runs (item 92)', async () => {
    const { call, takes, controller } = setup();
    Object.assign(takes, { currentPhase: 'paused', busy: true });
    expect(await call('audio.recording.state', {})).toMatchObject({
      ok: true,
      value: { phase: 'paused', notices: [{ kind: 'faulted', message: 'disk full' }] },
    });
    expect(await call('audio.preview.start', { deviceId: null })).toMatchObject({ ok: true });
    expect(controller.startPreview).not.toHaveBeenCalled();
    Object.assign(takes, { currentPhase: 'idle', busy: false });
    expect(await call('audio.recording.state', {})).toMatchObject({
      value: { phase: 'idle', notices: [] },
    });
    await call('audio.preview.start', { deviceId: 'x' });
    expect(controller.startPreview).toHaveBeenCalledWith('x', 'settings');
  });

  it('starts, pauses, resumes and stops a take through the take object', async () => {
    const { call, takes } = setup();
    const micInput = { kind: 'SystemDefault', deviceId: null };
    expect(await call('audio.recording.start', { title: 'T', microphone: micInput })).toMatchObject(
      {
        ok: true,
        value: { started: true, recordedAtMs: 9 },
      },
    );
    expect(takes.start).toHaveBeenCalledWith('T', micInput);
    expect(await call('audio.recording.pause', {})).toMatchObject({ value: { paused: true } });
    expect(await call('audio.recording.resume', {})).toMatchObject({ value: { resumed: true } });
    expect(await call('audio.recording.stop', {})).toMatchObject({
      value: { path: 'a.wav', pausedSeconds: 2, error: null },
    });
  });

  it('rejects a recording start with a bad microphone kind', async () => {
    const { call, takes } = setup();
    const result = await call('audio.recording.start', {
      title: 'T',
      microphone: { kind: 'Everything', deviceId: null },
    });
    expect(result).toMatchObject({ ok: false });
    expect(takes.start).not.toHaveBeenCalled();
  });

  it('returns the icon of an executable', async () => {
    const { call, appIcon } = setup();
    const exePath = String.raw`C:\Apps\Zoom.exe`;
    expect(await call('audio.apps.icon', { exePath })).toMatchObject({
      value: { dataUrl: 'data:image/png;base64,AA==' },
    });
    expect(appIcon).toHaveBeenCalledWith(exePath);
  });
});
