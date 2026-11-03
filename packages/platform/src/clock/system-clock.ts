import type { Clock } from '@vozella/core';

/** Adapter: the real clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
