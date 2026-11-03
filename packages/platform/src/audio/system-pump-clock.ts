import type { CancelSignal, PumpClock } from '@vozella/core';

/** Adapter: real time for the recording pump. */
export class SystemPumpClock implements PumpClock {
  nowMs(): number {
    return performance.now();
  }

  sleep(ms: number, cancel: CancelSignal): Promise<void> {
    if (cancel.cancelled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let off = (): void => undefined;
      const timer = setTimeout(() => {
        off();
        resolve();
      }, ms);
      off = cancel.onCancel(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
