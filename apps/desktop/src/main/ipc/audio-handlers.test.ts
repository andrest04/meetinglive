import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requestChannels, type RequestName } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioController } from '../audio/audio-controller';
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
  const pickAudioFile = vi.fn((_: readonly string[]) => Promise.resolve(pick));
  registerAudioHandlers({
    server: { ipc, logger: logger(), isTrusted: () => true },
    controller: controller as unknown as AudioController,
    pickAudioFile,
    nowMs: () => 5_000,
  });
  const call = async (name: RequestName, input: unknown): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    return handler(event as never, input);
  };
  return { call, controller, pickAudioFile, handlers };
}

describe('audio handlers', () => {
  it('registers every audio request channel and no recording start (the path is not the page to choose)', () => {
    const { handlers } = setup();
    const audioChannels = Object.keys(requestChannels).filter((n) => n.startsWith('audio.'));
    expect(audioChannels.sort()).toEqual([...handlers.keys()].sort());
    expect(audioChannels.some((n) => n.startsWith('audio.recording'))).toBe(false);
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
    expect(controller.startPreview).toHaveBeenCalledWith(null);
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
});
