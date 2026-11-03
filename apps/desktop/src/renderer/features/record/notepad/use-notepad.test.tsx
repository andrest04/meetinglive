// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNotepad } from './use-notepad';

type Listener = (payload: unknown) => void;

const state = (patch: Record<string, unknown>) => ({
  isRecording: false,
  isProcessing: false,
  notes: '',
  ...patch,
});

function install(initial: Record<string, unknown>) {
  const listeners = new Set<Listener>();
  const invoke = vi.fn((name: string) =>
    name === 'recording.getState'
      ? Promise.resolve({ ...state(initial), liveText: '' })
      : Promise.resolve({ accepted: true }),
  );
  Object.defineProperty(window, 'vozella', {
    value: {
      invoke,
      on: (name: string, listener: Listener) => {
        if (name === 'recording.state') listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    configurable: true,
    writable: true,
  });
  return {
    invoke,
    publish: (patch: Record<string, unknown>) => {
      act(() => {
        listeners.forEach((listener) => {
          listener(state(patch));
        });
      });
    },
  };
}

describe('useNotepad', () => {
  it('is hidden while idle and visible while recording or processing', async () => {
    const host = install({});
    const { result } = renderHook(() => useNotepad());
    await waitFor(() => {
      expect(host.invoke).toHaveBeenCalledWith('recording.getState', {});
    });
    expect(result.current.visible).toBe(false);
    host.publish({ isRecording: true });
    expect(result.current.visible).toBe(true);
    host.publish({ isProcessing: true, notes: 'kept while processing' });
    expect(result.current.visible).toBe(true);
    expect(result.current.notes).toBe('kept while processing');
    host.publish({});
    expect(result.current.visible).toBe(false);
  });

  it('B-10: the next take starts with no text from the previous one', async () => {
    const host = install({ isRecording: true, notes: 'take one notes' });
    const { result } = renderHook(() => useNotepad());
    await waitFor(() => {
      expect(result.current.notes).toBe('take one notes');
    });
    host.publish({});
    host.publish({ isRecording: true, notes: '' });
    expect(result.current.visible).toBe(true);
    expect(result.current.notes).toBe('');
  });

  it('sends the notes to main with recording.setNotes', async () => {
    const host = install({ isRecording: true });
    const { result } = renderHook(() => useNotepad());
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    result.current.setNotes('- item');
    expect(host.invoke).toHaveBeenCalledWith('recording.setNotes', { text: '- item' });
  });
});
