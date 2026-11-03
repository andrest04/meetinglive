// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTake } from './use-take';

const mic = { kind: 'SystemDefault', deviceId: null } as const;

type Handler = (input: Record<string, unknown>) => unknown;

function install(handlers: Record<string, Handler>) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const invoke = vi.fn((name: string, input: Record<string, unknown>) => {
    calls.push({ name, input });
    const handler = handlers[name];
    if (!handler) return Promise.resolve({});
    try {
      return Promise.resolve(handler(input));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  Object.defineProperty(window, 'vozella', {
    value: { invoke, on: () => () => undefined },
    configurable: true,
    writable: true,
  });
  return calls;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('useTake', () => {
  it('records, pauses, resumes and stops, and says where the file went', async () => {
    const calls = install({
      'audio.recording.start': () => ({ started: true, recordedAtMs: 1 }),
      'audio.recording.pause': () => ({ paused: true }),
      'audio.recording.resume': () => ({ resumed: true }),
      'audio.recording.stop': () => ({
        path: 'C:\\Lib\\Inbox\\2026-05-03 Sync.wav',
        recordedAtMs: 1,
        pausedSeconds: 3,
        error: null,
      }),
    });
    const { result } = renderHook(() => useTake());
    expect(result.current.phase).toBe('idle');
    await act(() => result.current.start('Sync', mic));
    expect(result.current.phase).toBe('recording');
    expect(calls[0]).toEqual({
      name: 'audio.recording.start',
      input: { title: 'Sync', microphone: mic },
    });
    await act(() => result.current.pause());
    expect(result.current.phase).toBe('paused');
    await act(() => result.current.resume());
    expect(result.current.phase).toBe('recording');
    await act(() => result.current.stop());
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toEqual({
      tone: 'info',
      message: { key: 'Ui_TakeSaved', args: ['2026-05-03 Sync.wav'] },
    });
  });

  it('shows Error_StartRecording and stays idle when the start fails', async () => {
    install({
      'audio.recording.start': () => ({ started: false, code: null, message: 'no device' }),
    });
    const { result } = renderHook(() => useTake());
    await act(() => result.current.start('a', mic));
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toEqual({
      tone: 'warning',
      message: { key: 'Error_StartRecording', args: ['no device'] },
    });
  });

  it('uses the plain words for a Windows build without process capture (item 39)', async () => {
    install({
      'audio.recording.start': () => ({
        started: false,
        code: 'process-loopback-unsupported',
        message: 'x',
      }),
    });
    const { result } = renderHook(() => useTake());
    await act(() => result.current.start('a', mic));
    expect(result.current.notice?.message.key).toBe('Ui_ProcessLoopbackUnsupported');
  });

  it('shows Error_StartRecording when the call itself fails', async () => {
    install({
      'audio.recording.start': () => {
        throw new Error('ipc down');
      },
    });
    const { result } = renderHook(() => useTake());
    await act(() => result.current.start('a', mic));
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice?.message).toEqual({
      key: 'Error_StartRecording',
      args: ['ipc down'],
    });
  });

  it('shows Error_StopRecording and returns to idle when stopping fails (item 49)', async () => {
    install({
      'audio.recording.start': () => ({ started: true, recordedAtMs: 1 }),
      'audio.recording.stop': () => ({
        path: 'C:\\x.wav',
        recordedAtMs: 1,
        pausedSeconds: 0,
        error: 'disk full',
      }),
    });
    const { result } = renderHook(() => useTake());
    await act(() => result.current.start('a', mic));
    await act(() => result.current.stop());
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toEqual({
      tone: 'warning',
      message: { key: 'Error_StopRecording', args: ['disk full'] },
    });
  });

  it('imports a picked file: importing status, then the saved file (items 148, 149)', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const calls = install({
      'audio.import.pickFile': () => ({ path: 'C:\\in\\a.mp3', recordedAtMs: 5 }),
      'audio.import.run': () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const { result } = renderHook(() => useTake());
    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.importAudio('Call');
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(result.current.phase).toBe('importing');
    });
    expect(result.current.notice).toEqual({
      tone: 'info',
      message: { key: 'Status_Importing', args: [] },
    });
    await act(async () => {
      finish({
        imported: true,
        path: 'C:\\Lib\\Inbox\\Call.wav',
        recordedAtMs: 5,
        endedAtMs: 10,
        durationSeconds: 1,
      });
      await done;
    });
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice?.message).toEqual({ key: 'Ui_TakeSaved', args: ['Call.wav'] });
    expect(calls.map((c) => c.name)).toEqual(['audio.import.pickFile', 'audio.import.run']);
  });

  it('does nothing when the file picker is cancelled', async () => {
    const calls = install({ 'audio.import.pickFile': () => null });
    const { result } = renderHook(() => useTake());
    await act(() => result.current.importAudio('x'));
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('shows Error_ImportAudio when the conversion fails', async () => {
    install({
      'audio.import.pickFile': () => ({ path: 'a.mp3', recordedAtMs: 5 }),
      'audio.import.run': () => ({ imported: false, message: 'bad codec' }),
    });
    const { result } = renderHook(() => useTake());
    await act(() => result.current.importAudio('x'));
    expect(result.current.phase).toBe('idle');
    expect(result.current.notice).toEqual({
      tone: 'warning',
      message: { key: 'Error_ImportAudio', args: ['bad codec'] },
    });
  });

  it('ignores a second command while one is running', async () => {
    let release: (value: unknown) => void = () => undefined;
    const calls = install({
      'audio.recording.start': () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const { result } = renderHook(() => useTake());
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.start('a', mic);
      await Promise.resolve();
    });
    await act(() => result.current.start('b', mic));
    await act(async () => {
      release({ started: true, recordedAtMs: 1 });
      await first;
    });
    expect(calls.filter((c) => c.name === 'audio.recording.start')).toHaveLength(1);
  });
});
