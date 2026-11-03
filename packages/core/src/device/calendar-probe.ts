/** Port: can the OS calendar be read? Only counts, never event content. */

export interface CalendarProbeResult {
  readonly hasIdentity: boolean;
  readonly packageFullName: string | null;
  readonly status: 'ok' | 'error';
  readonly hresult: string | null;
  readonly error: string | null;
  readonly calendarCount: number | null;
  readonly upcomingEventCount: number | null;
}

export interface CalendarProbePort {
  probe(): Promise<CalendarProbeResult>;
}
