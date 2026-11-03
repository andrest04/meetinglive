// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTake } from './use-take';

const mic = { kind: 'SystemDefault', deviceId: null } as const;

type Handler = (input: Record<string, unknown>) => unknown;

function install(handlers: Record<string, Handler>) {
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const listeners = new Set<(payload: unknown) => void>();
  const invoke = vi.fn((name: string, input: Record<string, unknown>) => {
    // The state query on mount is not part of what a test counts.
    if (name !== 'audio.recording.state') calls.push({ name, input });
    const handler = handlers[name];
    if (!handler) return Promise.resolve({});
    try {
      return Promise.resolve(handler(input));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke,
      on: (name: string, listener: (payload: unknown) => void) => {
        if (name === 'audio.recording.notice') listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    configurable: true,
    writable: true,
  });
  const emit = (payload: unknown): void => {
    act(() => {
      for (const listener of listeners) listener(payload);
    });
  };
  return Object.assign(calls, { emit });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

describe('useTake after leaving the page', () => {
  it('picks up a take that kept running in main, and can pause and stop it', async () => {
    const calls = install({
      'audio.recording.state': () => ({ phase: 'recording' }),
      'audio.recording.pause': () => ({ paused: true }),
      'audio.recording.stop': () => ({
        path: 'C://Lib//Inbox//a.wav',
        recordedAtMs: 1,
        pausedSeconds: 0,
        error: null,
      }),
    });
    const { result } = renderHook(() => useTake());
    await act(() => Promise.resolve());
    expect(result.current.phase).toBe('recording');
    await act(() => result.current.pause());
    expect(result.current.phase).toBe('paused');
    await act(() => result.current.stop());
    expect(result.current.phase).toBe('idle');
    expect(calls.some((c) => c.name === 'audio.recording.stop')).toBe(true);
  });

  it('stops the take when an output failure arrives after coming back', async () => {
    const calls = install({
      'audio.recording.state': () => ({ phase: 'paused' }),
      'audio.recording.stop': () => ({
        path: 'a.wav',
        recordedAtMs: 1,
        pausedSeconds: 0,
        error: null,
      }),
    });
    const { result } = renderHook(() => useTake());
    await act(() => Promise.resolve());
    calls.emit({ kind: 'output-failed', message: 'disk full' });
    await act(() => Promise.resolve());
    expect(calls.some((c) => c.name === 'audio.recording.stop')).toBe(true);
    expect(result.current.phase).toBe('idle');
  });

  it('stays idle when main has no take or does not answer', async () => {
    install({ 'audio.recording.state': () => ({ phase: 'idle' }) });
    const { result } = renderHook(() => useTake());
    await act(() => Promise.resolve());
    expect(result.current.phase).toBe('idle');
  });
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

  describe('a capture failure while recording (items 49, 57)', () => {
    const stopped = {
      path: String.raw`C:\Lib\Inbox\a.wav`,
      recordedAtMs: 1,
      pausedSeconds: 0,
      error: null,
    };

    it('stops on the first output failure and keeps its message', async () => {
      const calls = install({
        'audio.recording.start': () => ({ started: true, recordedAtMs: 1 }),
        'audio.recording.stop': () => stopped,
      });
      const { result } = renderHook(() => useTake());
      await act(() => result.current.start('a', mic));
      calls.emit({ kind: 'output-failed', message: 'the app exited' });
      await vi.waitFor(() => {
        expect(result.current.phase).toBe('idle');
      });
      expect(calls.filter((c) => c.name === 'audio.recording.stop')).toHaveLength(1);
      expect(result.current.notice).toEqual({
        tone: 'warning',
        message: { key: 'Error_OutputCaptureFailed', args: ['the app exited'] },
      });
    });

    it('does not replace the failure with Error_StopRecording', async () => {
      const calls = install({
        'audio.recording.start': () => ({ started: true, recordedAtMs: 1 }),
        'audio.recording.stop': () => ({ ...stopped, error: 'disk full' }),
      });
      const { result } = renderHook(() => useTake());
      await act(() => result.current.start('a', mic));
      calls.emit({ kind: 'faulted', message: 'writer broke' });
      await vi.waitFor(() => {
        expect(result.current.phase).toBe('idle');
      });
      expect(result.current.notice?.message.key).toBe('Error_CaptureFaulted');
    });

    it('handles only the first failure and leaves a lost source to the status line', async () => {
      const calls = install({
        'audio.recording.start': () => ({ started: true, recordedAtMs: 1 }),
        'audio.recording.stop': () => stopped,
      });
      const { result } = renderHook(() => useTake());
      await act(() => result.current.start('a', mic));
      calls.emit({ kind: 'source-lost', source: 'Microphone', remaining: 1 });
      expect(result.current.phase).toBe('recording');
      calls.emit({ kind: 'faulted', message: 'one' });
      calls.emit({ kind: 'faulted', message: 'two' });
      await vi.waitFor(() => {
        expect(result.current.phase).toBe('idle');
      });
      expect(calls.filter((c) => c.name === 'audio.recording.stop')).toHaveLength(1);
      expect(result.current.notice?.message.args).toEqual(['one']);
    });

    it('stops a take whose notice came before the start answer (item 37)', async () => {
      let release: (value: unknown) => void = () => undefined;
      const calls = install({
        'audio.recording.start': () =>
          new Promise((resolve) => {
            release = resolve;
          }),
        'audio.recording.stop': () => stopped,
      });
      const { result } = renderHook(() => useTake());
      let first: Promise<void> = Promise.resolve();
      await act(async () => {
        first = result.current.start('a', mic);
        await Promise.resolve();
      });
      expect(result.current.phase).toBe('starting');
      calls.emit({ kind: 'output-failed', message: 'the app exited' });
      await act(async () => {
        release({ started: true, recordedAtMs: 1 });
        await first;
      });
      await vi.waitFor(() => {
        expect(result.current.phase).toBe('idle');
      });
      expect(calls.filter((c) => c.name === 'audio.recording.stop')).toHaveLength(1);
      expect(result.current.notice?.message).toEqual({
        key: 'Error_OutputCaptureFailed',
        args: ['the app exited'],
      });
    });
  });
});
