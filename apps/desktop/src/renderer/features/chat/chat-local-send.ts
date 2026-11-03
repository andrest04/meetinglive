import { useSyncExternalStore } from 'react';

/**
 * True from the moment the page starts a send until it settles. It lives above the chat bar so the
 * bar can keep New chat disabled in the gap before main marks the send as started.
 */
let active = false;
const listeners = new Set<() => void>();

export function setLocalSendActive(value: boolean): void {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener();
}

export function useLocalSendActive(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => active,
  );
}
