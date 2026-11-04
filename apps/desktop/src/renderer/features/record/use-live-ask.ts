import type { RecordingAnswerDto } from '@vozella/contracts';
import { create } from 'zustand';
import { readStored, writeStored } from '../../app/preference-storage';

/**
 * The live ask of the Record page (spec 2.8, typed part). Main streams the answer through
 * `recording.answer`; the page keeps the last one and the state of the web toggle, which outlives
 * a take (item 114). Armed questions and auto-detection were dropped by the owner on 2026-11-03.
 */

const WEB_KEY = 'vozella.liveWebSearch';

export const IDLE_ANSWER: RecordingAnswerDto = {
  isAnswering: false,
  text: '',
  error: null,
  usedWeb: false,
  canUseWebSearch: false,
};

export interface LiveAskStore {
  readonly answer: RecordingAnswerDto;
  /** The toggle as the user left it. Whether it is honoured depends on `answer.canUseWebSearch`. */
  readonly webSearch: boolean;
}

const initial = (): LiveAskStore => ({
  answer: IDLE_ANSWER,
  webSearch: readStored(WEB_KEY) === '1',
});

export const useLiveAskStore = create<LiveAskStore>(() => initial());

const set = useLiveAskStore.setState;
const get = useLiveAskStore.getState;

/** Test seam: forget everything, as a fresh window would. */
export function resetLiveAskStore(): void {
  set(initial(), true);
}

export const applyAnswer = (answer: RecordingAnswerDto): void => {
  set({ answer });
};

export function setWebSearch(on: boolean): void {
  writeStored(WEB_KEY, on ? '1' : '0');
  set({ webSearch: on });
}

let connections = 0;
let disconnect: (() => void) | null = null;

/** Listens to the answers while a window part is mounted; the shell holds it for the whole run. */
export function connectLiveAsk(): () => void {
  connections += 1;
  if (connections === 1) disconnect = window.vozella.on('recording.answer', applyAnswer);
  return () => {
    connections -= 1;
    if (connections === 0) {
      disconnect?.();
      disconnect = null;
    }
  };
}

/** Returns true when main took the question (it answers through the event). */
export async function askLive(
  question: string,
  options: { readonly preset?: boolean } = {},
): Promise<boolean> {
  const text = question.trim();
  if (text === '') return false;
  try {
    const result = await window.vozella.invoke('recording.ask', {
      question: text,
      webSearch: get().webSearch,
      ...(options.preset ? { preset: true } : {}),
    });
    return result.accepted;
  } catch {
    return false;
  }
}

export async function cancelLiveAsk(): Promise<void> {
  try {
    await window.vozella.invoke('recording.cancelAsk', {});
  } catch {
    // The answer finishes on its own.
  }
}
