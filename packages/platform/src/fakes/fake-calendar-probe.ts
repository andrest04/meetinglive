import type { CalendarProbePort, CalendarProbeResult } from '@vozella/core';

const DEFAULT: CalendarProbeResult = {
  hasIdentity: false,
  packageFullName: null,
  status: 'ok',
  hresult: null,
  error: null,
  calendarCount: 1,
  upcomingEventCount: 0,
};

/** Fake: returns a fixed probe result. */
export class FakeCalendarProbe implements CalendarProbePort {
  constructor(private readonly result: CalendarProbeResult = DEFAULT) {}

  probe(): Promise<CalendarProbeResult> {
    return Promise.resolve(this.result);
  }
}
