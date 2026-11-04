import { requestChannels, type RequestName } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { LiveAsk } from '../recording/live-ask-handlers';
import type { RecordingService } from '../recording/recording-service';
import type { IpcEventLike } from '../security/trusted-origin';
import type { IpcMainLike } from './ipc-server';
import { registerRecordingHandlers } from './recording-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};

function setup() {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const state = {
    phase: 'Idle',
    isRecording: false,
    isPaused: false,
    isProcessing: false,
    elapsedMs: 0,
    elapsedAsOfMs: 1,
    isTicking: false,
    status: [],
    micLevel: 0,
    microphoneActive: true,
    captureNotices: [],
    meetingId: null,
    title: '',
    recordedAtMs: null,
    highlightCount: 0,
    notes: '',
    canRetry: false,
    lastMeeting: null,
    liveText: '',
  };
  const service = {
    getState: vi.fn(() => state),
    getSetup: vi.fn(() => Promise.resolve({ canRecord: true })),
    start: vi.fn(() =>
      Promise.resolve({ started: true as const, meetingId: 'm1', recordedAtMs: 5 }),
    ),
    pause: vi.fn(() => Promise.resolve(true)),
    resume: vi.fn(() => Promise.resolve(true)),
    stop: vi.fn(() => Promise.resolve(true)),
    discard: vi.fn(() => Promise.resolve(true)),
    highlight: vi.fn(() => ({ marked: true, elapsedMs: 4000 })),
    setNotes: vi.fn(() => true),
    cancelProcessing: vi.fn(() => true),
    retryProcessing: vi.fn(() => false),
    importAudio: vi.fn(() => Promise.resolve({ started: true as const, meetingId: 'm2' })),
  };
  registerRecordingHandlers({
    server: { ipc, logger: logger(), isTrusted: () => true },
    service: service as unknown as RecordingService,
    closeDialogs: { answer: (id: string) => id === 'r1' },
    liveAsk: { ask: vi.fn(() => true), cancel: vi.fn(() => false) } as unknown as LiveAsk,
  });
  const call = async (name: RequestName, input: unknown): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    return handler(event as never, input);
  };
  return { call, service, handlers };
}

describe('recording handlers', () => {
  it('registers every recording request channel', () => {
    const { handlers } = setup();
    const channels = Object.keys(requestChannels).filter((n) => n.startsWith('recording.'));
    expect(channels.sort()).toEqual([...handlers.keys()].sort());
  });

  it('starts with the sources of the page', async () => {
    const { call, service } = setup();
    const input = {
      title: 'Standup',
      folderId: null,
      microphone: { kind: 'SystemDefault', deviceId: null },
      processId: 7,
      appName: 'Zoom',
    };
    expect(await call('recording.start', input)).toMatchObject({
      ok: true,
      value: { started: true, meetingId: 'm1' },
    });
    expect(service.start).toHaveBeenCalledWith(input);
  });

  it('accepts a start that never loaded the sources', async () => {
    const { call, service } = setup();
    await call('recording.start', {
      title: '',
      folderId: null,
      microphone: null,
      appName: null,
    });
    expect(service.start).toHaveBeenCalledWith(
      expect.objectContaining({ microphone: null, title: '' }),
    );
  });

  it('answers the control requests from the service', async () => {
    const { call } = setup();
    expect(await call('recording.pause', {})).toMatchObject({ value: { paused: true } });
    expect(await call('recording.resume', {})).toMatchObject({ value: { resumed: true } });
    expect(await call('recording.stop', {})).toMatchObject({ value: { stopped: true } });
    expect(await call('recording.discard', {})).toMatchObject({ value: { discarded: true } });
    expect(await call('recording.highlight', {})).toMatchObject({
      value: { marked: true, elapsedMs: 4000 },
    });
    expect(await call('recording.setNotes', { text: 'x' })).toMatchObject({
      value: { accepted: true },
    });
    expect(await call('recording.cancelProcessing', { meetingId: null })).toMatchObject({
      value: { cancelled: true },
    });
    expect(await call('recording.retryProcessing', {})).toMatchObject({
      value: { started: false },
    });
  });

  it('imports a picked file and relays the close dialog answers', async () => {
    const { call, service } = setup();
    const input = { title: 'Call', folderId: null, path: 'C:\\in\\call.mp3' };
    expect(await call('recording.import', input)).toMatchObject({
      value: { started: true, meetingId: 'm2' },
    });
    expect(service.importAudio).toHaveBeenCalledWith(input);
    expect(await call('recording.closeAnswer', { requestId: 'r1', accepted: true })).toMatchObject({
      value: { received: true },
    });
    expect(await call('recording.closeAnswer', { requestId: 'zz', accepted: true })).toMatchObject({
      value: { received: false },
    });
  });

  it('returns the state with the canvas text', async () => {
    const { call } = setup();
    expect(await call('recording.getState', {})).toMatchObject({ ok: true });
  });

  it('returns the setup checklist', async () => {
    const { call, service } = setup();
    await call('recording.getSetup', {});
    expect(service.getSetup).toHaveBeenCalledTimes(1);
  });
});
