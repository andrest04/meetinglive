// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMicrophones } from './use-microphones';

const list = [
  { kind: 'None', deviceId: null, name: null },
  { kind: 'SystemDefault', deviceId: null, name: null },
  { kind: 'Device', deviceId: 'a', name: 'A' },
  { kind: 'Device', deviceId: 'b', name: 'B' },
] as const;

interface Pending {
  readonly input: unknown;
  readonly resolve: (value: unknown) => void;
}

function install() {
  const pending: Pending[] = [];
  const invoke = vi.fn((name: string, input: unknown) => {
    if (name !== 'audio.microphones.load') return Promise.resolve({ saved: true });
    return new Promise((resolve) => pending.push({ input, resolve }));
  });
  Object.defineProperty(window, 'vozella', { value: { invoke }, configurable: true });
  return pending;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'vozella');
});

const answer = (selected: unknown, options: readonly unknown[] = list) => ({ options, selected });

describe('useMicrophones', () => {
  it('drops the answer of a reload that a newer reload replaced (item 102)', async () => {
    const pending = install();
    const { result } = renderHook(() => useMicrophones());
    act(() => {
      result.current.reload();
    });
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[1]?.resolve(answer({ kind: 'Device', deviceId: 'b' }));
      await Promise.resolve();
    });
    await act(async () => {
      pending[0]?.resolve(answer({ kind: 'Device', deviceId: 'a' }));
      await Promise.resolve();
    });
    expect(result.current.selected).toEqual({ kind: 'Device', deviceId: 'b' });
  });

  it('keeps the same array when a reload brings the same list (item 100)', async () => {
    const pending = install();
    const { result } = renderHook(() => useMicrophones());
    await act(async () => {
      pending[0]?.resolve(answer({ kind: 'SystemDefault', deviceId: null }));
      await Promise.resolve();
    });
    const first = result.current.options;
    act(() => {
      result.current.reload();
    });
    await act(async () => {
      pending[1]?.resolve(answer({ kind: 'SystemDefault', deviceId: null }, [...list]));
      await Promise.resolve();
    });
    expect(result.current.options).toBe(first);
  });

  it('keeps a pick made while a reload was in flight', async () => {
    const pending = install();
    const { result } = renderHook(() => useMicrophones());
    await act(async () => {
      pending[0]?.resolve(answer({ kind: 'SystemDefault', deviceId: null }));
      await Promise.resolve();
    });
    act(() => {
      result.current.reload();
    });
    act(() => {
      result.current.choose({ kind: 'Device', deviceId: 'b' });
    });
    await act(async () => {
      pending[1]?.resolve(answer({ kind: 'SystemDefault', deviceId: null }));
      await Promise.resolve();
    });
    expect(result.current.selected).toEqual({ kind: 'Device', deviceId: 'b' });
  });
});
