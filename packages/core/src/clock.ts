/**
 * Port: the current time. Domain code asks a Clock instead of calling Date.now(),
 * so tests can control time. Adapter: SystemClock. Fake: FakeClock (both in platform).
 */
export interface Clock {
  now(): Date;
}

/** Example of domain code written against the port, not the system. */
export function isExpired(clock: Clock, expiresAt: Date): boolean {
  return clock.now().getTime() >= expiresAt.getTime();
}
