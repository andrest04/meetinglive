import { describe, expect, it } from 'vitest';
import type { MeetingRecord } from '../library/meeting';
import { parseMeetingMarkdown, renderMeetingMarkdown } from '../library/meeting-markdown';
import { summaryFromAnswer } from './answer-to-summary';

const stored = {
  summary: 'Old summary.',
  actionItems: [
    { text: 'Ana sends the deck', isDone: true },
    { text: 'Luis books the room', isDone: false },
  ],
};

describe('summaryFromAnswer (T4)', () => {
  it('a plain answer becomes the summary and keeps the stored action items', () => {
    const result = summaryFromAnswer('  A **longer** summary.\r\n\r\n- point one\n', stored);
    expect(result).toEqual({
      summary: 'A **longer** summary.\n\n- point one',
      actionItems: stored.actionItems,
    });
    expect(result?.actionItems[0]).not.toBe(stored.actionItems[0]);
  });

  it('a summary-shaped answer is split like a summary run', () => {
    const answer = '## Summary\n\nWe agreed.\n\n## Action Items\n\n- [ ] Ship it\n- [x] Test it\n';
    expect(summaryFromAnswer(answer, stored)).toEqual({
      summary: 'We agreed.',
      actionItems: [
        { text: 'Ship it', isDone: false },
        { text: 'Test it', isDone: true },
      ],
    });
  });

  it('a `## Summary` answer without an action section keeps the stored action items', () => {
    expect(summaryFromAnswer('## Summary\n\nOnly prose.', stored)).toEqual({
      summary: 'Only prose.',
      actionItems: stored.actionItems,
    });
  });

  it('an empty action section clears the action items', () => {
    expect(summaryFromAnswer('## Summary\nText\n## Action Items\n', stored)).toEqual({
      summary: 'Text',
      actionItems: [],
    });
  });

  it('action items alone keep the stored summary', () => {
    expect(summaryFromAnswer('## Action Items\n- [ ] One', stored)).toEqual({
      summary: 'Old summary.',
      actionItems: [{ text: 'One', isDone: false }],
    });
  });

  it('keeps time citations as links', () => {
    const link = '[05:12](https://meetinglive.local/meeting/m1?t=312)';
    expect(summaryFromAnswer(`Decided at ${link}.`, stored)?.summary).toBe(`Decided at ${link}.`);
  });

  it('a blank answer saves nothing', () => {
    expect(summaryFromAnswer('  \n ', stored)).toBeNull();
    expect(summaryFromAnswer('## Summary\n\n', stored)).toBeNull();
  });
});

describe('reserved headers inside an applied answer (T4)', () => {
  it('a `## Notes`-like line in the body survives the meeting file round trip', () => {
    const answer = 'Intro\n## Personal Notes\n## Transcript\nEnd';
    const applied = summaryFromAnswer(answer, stored);
    if (applied === null) throw new Error('nothing applied');
    const record = { ...meetingRecord(), summary: applied.summary, notes: 'mine' };
    const markdown = renderMeetingMarkdown(record);
    expect(markdown).toContain('## Personal Notes ##');
    const back = parseMeetingMarkdown('x.md', markdown, { fileExists: () => false });
    expect(back.summary).toBe(answer);
    expect(back.notes).toBe('mine');
    expect(back.transcript).toBe('Ana: hi');
  });
});

function meetingRecord(): MeetingRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Weekly',
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
    transcript: 'Ana: hi',
    summary: null,
    actionItems: [],
    jevAnalysis: null,
    notes: null,
    followUp: null,
    projectPlan: null,
  };
}
