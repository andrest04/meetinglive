import { describe, expect, it } from 'vitest';
import type { MeetingRecord } from '../library/meeting';
import { createRetranscriptionRequest } from '../transcription/retranscription';
import { pipelineRequestFromRetranscription } from './entry-points';

const record = (over: Partial<MeetingRecord> = {}): MeetingRecord =>
  ({
    id: 'm1',
    title: 'Standup',
    audioFilePath: 'C:\\a.wav',
    recordedAt: '2026-11-03T10:00:00+00:00',
    endedAt: '2026-11-03T10:30:00+00:00',
    folderId: null,
    transcript: '[00:01.00-00:02.00] ★ hi',
    calendarEventId: 'e1',
    attendees: ['Ana'],
    brief: 'b',
    noteTemplateId: null,
    calendarId: null,
    seriesId: null,
    joinUrl: null,
    ...over,
  }) as MeetingRecord;

describe('pipelineRequestFromRetranscription', () => {
  it('drops the live draft, keeps the meeting context and converts dates to epoch ms', () => {
    const { request } = pipelineRequestFromRetranscription(
      createRetranscriptionRequest(record(), 'be brief'),
      0,
    );
    expect(request.liveDraft).toBeNull();
    expect(request.recordedAtMs).toBe(Date.parse('2026-11-03T10:00:00Z'));
    expect(request.endedAtMs).toBe(Date.parse('2026-11-03T10:30:00Z'));
    expect(request).toMatchObject({
      calendarEventId: 'e1',
      attendees: ['Ana'],
      brief: 'b',
      templateInstructions: 'be brief',
      pausedDurationMs: 0,
    });
  });

  it('treats a missing end as unknown', () => {
    const { request } = pipelineRequestFromRetranscription(
      createRetranscriptionRequest(record({ endedAt: null }), null),
      0,
    );
    expect(request.endedAtMs).toBeNull();
  });
});
