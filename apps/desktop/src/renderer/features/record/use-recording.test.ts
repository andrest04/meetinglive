// @vitest-environment jsdom
import type { RecordingStateDto } from '@vozella/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyRecordingState,
  connectRecording,
  importRecording,
  resetRecordingStore,
  setFolderId,
  setTitle,
  startRecording,
  useRecordingStore,
} from './use-recording';

const idle: RecordingStateDto = {
  phase: 'Idle',
  isRecording: false,
  isPaused: false,
  isProcessing: false,
  elapsedMs: 0,
  elapsedAsOfMs: 0,
  isTicking: false,
  status: [],
  micLevel: 0,
  captureNotices: [],
  meetingId: null,
  title: '',
  recordedAtMs: null,
  highlightCount: 0,
  notes: '',
  canRetry: false,
  lastMeeting: null,
};

type Handler = (input: Record<string, unknown>) => unknown;

function install(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const offs = { count: 0 };
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke: (name: string, input: Record<string, unknown>) => {
        calls.push(name);
        const handler = handlers[name];
        if (!handler) return Promise.reject(new Error('unhandled ' + name));
        return Promise.resolve(handler(input));
      },
      on: () => () => {
        offs.count += 1;
      },
    },
    configurable: true,
    writable: true,
  });
  return { calls, offs };
}

beforeEach(() => {
  resetRecordingStore();
});
afterEach(() => {
  Reflect.deleteProperty(window, 'vozella');
});

describe('the recording store', () => {
  it('resets the title for the next take when the take ends, not before', () => {
    setTitle('Typed');
    const before = useRecordingStore.getState().defaultAtMs;
    applyRecordingState({ ...idle, phase: 'Recording', isRecording: true });
    expect(useRecordingStore.getState().title).toBe('Typed');
    applyRecordingState({ ...idle, phase: 'Processing', isProcessing: true });
    expect(useRecordingStore.getState().title).toBe('Typed');
    vi.useFakeTimers();
    vi.setSystemTime(before + 60_000);
    applyRecordingState(idle);
    expect(useRecordingStore.getState().title).toBeNull();
    expect(useRecordingStore.getState().defaultAtMs).toBe(before + 60_000);
    vi.useRealTimers();
  });

  it('does not reset the title on the first state it hears while idle', () => {
    setTitle('Typed');
    applyRecordingState(idle);
    expect(useRecordingStore.getState().title).toBe('Typed');
  });

  it('shows a thrown start as the typed start error and returns to idle', async () => {
    install({ 'recording.start': () => Promise.reject(new Error('boom')) });
    const started = await startRecording({
      title: 'x',
      microphone: null,
      processId: null,
      appName: null,
    });
    expect(started).toBe(false);
    expect(useRecordingStore.getState().notice).toEqual({
      key: 'Error_StartRecording',
      args: ['boom'],
      severity: 'error',
    });
    expect(useRecordingStore.getState().busy).toBeNull();
  });

  it('reads the setup again when main says it is not ready, and shows no words of its own', async () => {
    const api = install({
      'recording.start': () => ({ started: false, reason: 'not-ready', message: null }),
      'recording.getSetup': () => ({ canRecord: false }),
    });
    await startRecording({ title: 'x', microphone: null, processId: null, appName: null });
    expect(api.calls).toContain('recording.getSetup');
    expect(useRecordingStore.getState().notice).toBeNull();
  });

  it('ignores a second start while one runs', async () => {
    let release: (value: unknown) => void = () => undefined;
    const api = install({
      'recording.start': () => new Promise((resolve) => (release = resolve)),
    });
    const first = startRecording({ title: 'x', microphone: null, processId: null, appName: null });
    expect(
      await startRecording({ title: 'y', microphone: null, processId: null, appName: null }),
    ).toBe(false);
    release({ started: true, meetingId: 'm', recordedAtMs: 1 });
    expect(await first).toBe(true);
    expect(api.calls.filter((name) => name === 'recording.start')).toHaveLength(1);
  });

  it('sends the destination with an import and says nothing when the picker is cancelled', async () => {
    const api = install({ 'audio.import.pickFile': () => null });
    setFolderId('f1');
    expect(await importRecording('t')).toBe(false);
    expect(api.calls).toEqual(['audio.import.pickFile']);
    expect(useRecordingStore.getState().notice).toBeNull();
  });

  it('listens once for any number of pages and lets go with the last one', () => {
    const api = install({
      'recording.getState': () => ({ ...idle, liveText: '' }),
      'recording.getSetup': () => ({}),
      'library.load': () => ({ ok: true, folders: [], meetings: [], skipped: [] }),
    });
    const first = connectRecording();
    const second = connectRecording();
    first();
    expect(api.offs.count).toBe(0);
    second();
    expect(api.offs.count).toBe(4);
  });
});
