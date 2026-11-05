import {
  CancelSource,
  InMemoryMeetingRepository,
  InMemorySettingsStore,
  type MeetingRecord,
} from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { ObservedSummaryService } from './observed-summary-service';

const ID = '11111111-1111-1111-1111-111111111111';

const record: MeetingRecord = {
  id: ID,
  title: 'Standup',
  recordedAt: '2026-09-01T12:00:00.0000000+00:00',
  endedAt: null,
  audioFilePath: '',
  sourcePath: null,
  folderId: null,
  summaryProvider: null,
  calendarEventId: null,
  calendarId: null,
  seriesId: null,
  joinUrl: null,
  noteTemplateId: null,
  attendees: [],
  brief: null,
  transcript: 'Spoken text',
  summary: null,
  actionItems: [],
  jevAnalysis: null,
  notes: null,
  followUp: null,
  projectPlan: null,
};

function build(gate: Promise<unknown>) {
  const meetings = new InMemoryMeetingRepository();
  meetings.records.set(ID, record);
  const seen: boolean[] = [];
  const service: ObservedSummaryService = new ObservedSummaryService(
    {
      meetings,
      settings: new InMemorySettingsStore(),
      resolver: {
        resolveSummaryProvider: async () => {
          await gate;
          return { status: 'needs-setup', kind: 'local', reason: 'model-missing' } as never;
        },
      },
      clock: { now: () => new Date('2026-09-05T15:00:00.000Z') },
      notifyMeetingChanged: vi.fn(),
    },
    () => {
      seen.push(service.isGenerating(ID));
    },
  );
  return { service, seen };
}

describe('ObservedSummaryService', () => {
  it('reports a run when it starts and again when it ends, so the Library list shows it busy', async () => {
    let release: (value: unknown) => void = () => undefined;
    const { service, seen } = build(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const run = service.generate({ meetingId: ID, regenerate: false, cancel: new CancelSource() });
    expect(seen).toEqual([true]);
    release(null);
    await run;
    expect(seen).toEqual([true, false]);
  });

  it('says nothing about a request that never became a run', async () => {
    const { service, seen } = build(Promise.resolve());
    const first = service.generate({
      meetingId: ID,
      regenerate: false,
      cancel: new CancelSource(),
    });
    const second = await service.generate({
      meetingId: ID,
      regenerate: false,
      cancel: new CancelSource(),
    });
    expect(second).toEqual({ status: 'busy' });
    await first;
    expect(seen).toEqual([true, false]);
  });
});
