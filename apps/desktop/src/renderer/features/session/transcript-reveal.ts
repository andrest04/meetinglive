import { compactMeetingId } from '@vozella/core';
import { useSyncExternalStore } from 'react';

/** A request to show one moment of a meeting's transcript (a chat time citation, T3). */
export interface TranscriptReveal {
  /** 32 lowercase hex, whatever shape the caller had. */
  readonly meetingId: string;
  readonly seconds: number;
  /** Tells two requests for the same moment apart, so a second click reveals again. */
  readonly nonce: number;
}

let pending: TranscriptReveal | null = null;
let counter = 0;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Asks the Transcript tab of `meetingId` to show `seconds`. The request waits until that tab is
 * mounted and loaded (the chat opens it right after), and a newer request replaces it.
 */
export function requestTranscriptReveal(meetingId: string, seconds: number): void {
  counter += 1;
  pending = { meetingId: compactMeetingId(meetingId), seconds, nonce: counter };
  notify();
}

/** The waiting request, for any meeting. */
export const peekTranscriptReveal = (): TranscriptReveal | null => pending;

/** Drops the request once the tab has shown it; a newer one stays. */
export function completeTranscriptReveal(nonce: number): void {
  if (pending?.nonce !== nonce) return;
  pending = null;
  notify();
}

/** The waiting request when it is for `meetingId`, else null. Re-renders when it changes. */
export function usePendingTranscriptReveal(meetingId: string): TranscriptReveal | null {
  const current = useSyncExternalStore(subscribe, peekTranscriptReveal);
  return current !== null && current.meetingId === compactMeetingId(meetingId) ? current : null;
}
