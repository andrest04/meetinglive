import { describe, expect, it } from 'vitest';
import { MeetingFormatError, type JevAnalysis, type MeetingRecord } from './meeting';
import { parseMeetingMarkdown, renderMeetingMarkdown } from './meeting-markdown';

const ID = '11111111-1111-1111-1111-111111111111';

function meeting(patch: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
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
    transcript: null,
    summary: null,
    actionItems: [],
    jevAnalysis: null,
    notes: null,
    followUp: null,
    projectPlan: null,
    ...patch,
  };
}

const noFiles = { fileExists: () => false };
const parse = (text: string, path = 'x.md') => parseMeetingMarkdown(path, text, noFiles);

describe('render', () => {
  it('writes the minimal record byte for byte, keeping the empty audioFilePath space', () => {
    expect(renderMeetingMarkdown(meeting())).toBe(
      `---\nid: ${ID}\ntitle: Standup\nrecordedAt: 2026-09-01T12:00:00.0000000+00:00\naudioFilePath: \n---\n`,
    );
  });

  it('writes the existing format byte for byte (golden)', () => {
    const existing =
      '---\n' +
      `id: ${ID}\n` +
      'title: Standup\n' +
      'recordedAt: 2026-09-01T12:00:00.0000000+00:00\n' +
      'audioFilePath: \n' +
      '---\n' +
      '\n## Brief\n\nBrief text\n' +
      '\n## Transcript\n\nHello there\n' +
      '\n## Summary\n\n### Notes\nHello\n\n## Decisions\nShip it\n' +
      '\n## Action Items\n\n- [ ] Follow up\n- [x] Done thing\n' +
      '\n## Personal Notes\n\nA closed heading stays literal\n## Summary ##\nEnd\n' +
      '\n## Follow-up\n\nSubject: hi\n' +
      '\n## Project plan\n\n### Steps\nShip\n';
    const parsed = parse(existing);
    expect(parsed.brief).toBe('Brief text');
    expect(parsed.transcript).toBe('Hello there');
    expect(parsed.summary).toBe('### Notes\nHello\n\n## Decisions\nShip it');
    expect(parsed.actionItems).toHaveLength(2);
    expect(parsed.notes).toBe('A closed heading stays literal\n## Summary ##\nEnd');
    expect(parsed.followUp).toBe('Subject: hi');
    expect(parsed.projectPlan).toBe('### Steps\nShip');
    expect(renderMeetingMarkdown(parsed)).toBe(existing);
  });

  it('round-trips every field', () => {
    const jev: JevAnalysis = {
      meetingType: 'standup',
      meetingTypeConfidence: 0.85,
      spokenLanguage: 'es',
      urgencyScore: 1,
      urgencyConfidence: 0.9,
      containsDecisions: 0.8,
      containsCommitments: 0.2,
      piiRisk: 0.01,
      summaryFaithful: null,
      suggestedFolderId: 'inbox',
      folderConfidence: 0.5,
      actionItems: [{ text: 'Follow up: reunión', relation: 'supports', confidence: 0.88 }],
      model: 'jev-1.13.0',
      analyzedAt: '2026-09-01T13:00:00+00:00',
    };
    const full = meeting({
      title: 'Weekly sync: planning',
      endedAt: '2026-09-01T13:45:00.0000000-05:00',
      recordedAt: '2026-09-01T12:00:00.0000000-05:00',
      audioFilePath: 'C:\\Lib\\Universidad\\2026-09-01 Weekly sync planning.wav',
      folderId: '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b',
      summaryProvider: 'local',
      calendarEventId: 'AAMkAGI2',
      calendarId: 'cal-1',
      seriesId: 'series-9',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
      noteTemplateId: 'one-on-one',
      attendees: ['Ana Perez', 'Luis Gomez'],
      brief: 'Last meeting ended with two open questions.',
      transcript: '[00:00:03] Ana: Hello everyone.',
      summary: '### Notes\nHello\n\n## Decisions\nShip it',
      actionItems: [
        { text: 'Follow up with Luis', isDone: false },
        { text: 'Send the notes', isDone: true },
      ],
      jevAnalysis: jev,
      notes: 'Remember the exam date.',
      followUp: 'Subject: recap',
      projectPlan: '### Steps\nShip',
    });
    const text = renderMeetingMarkdown(full);
    expect(parse(text, 'a.md')).toEqual({ ...full, sourcePath: 'a.md' });
    expect(text).not.toMatch(/apiKey|secret/i);
  });

  it('orders frontmatter as the spec says and omits unset optional fields', () => {
    const text = renderMeetingMarkdown(
      meeting({
        endedAt: '2026-09-01T13:00:00.0000000+00:00',
        folderId: '7d1e0a52-33c4-4f6b-8a90-0c1d2e3f4a5b',
        summaryProvider: 'local',
        calendarEventId: 'e',
        attendees: ['A', 'B'],
      }),
    );
    const keys = text
      .split('\n')
      .slice(1, text.split('\n').indexOf('---', 1))
      .map((l) => l.split(':')[0]);
    expect(keys).toEqual([
      'id',
      'title',
      'recordedAt',
      'endedAt',
      'audioFilePath',
      'folderId',
      'summaryProvider',
      'calendarEventId',
      'attendees',
    ]);
    expect(renderMeetingMarkdown(meeting())).not.toContain('folderId');
    expect(renderMeetingMarkdown(meeting())).not.toContain('endedAt');
  });

  it('writes Jev as one compact camelCase line with .NET escaping', () => {
    const text = renderMeetingMarkdown(
      meeting({
        jevAnalysis: {
          meetingType: 'ñ+x',
          meetingTypeConfidence: null,
          spokenLanguage: null,
          urgencyScore: 0,
          urgencyConfidence: null,
          containsDecisions: 0,
          containsCommitments: 0,
          piiRisk: 0,
          summaryFaithful: null,
          suggestedFolderId: null,
          folderConfidence: null,
          actionItems: [],
          model: 'm',
          analyzedAt: '2026-09-01T13:00:00+00:00',
        },
      }),
    );
    expect(text).toContain(
      '\n## Jev\n\n{"meetingType":"\\u00F1\\u002Bx","meetingTypeConfidence":null,',
    );
    expect(text.endsWith('"analyzedAt":"2026-09-01T13:00:00\\u002B00:00"}\n')).toBe(true);
  });

  it('skips whitespace-only sections consistently (B21)', () => {
    const text = renderMeetingMarkdown(meeting({ transcript: '   \n', summary: '\n', notes: ' ' }));
    expect(text).not.toContain('## Transcript');
    expect(text).not.toContain('## Summary');
    expect(text).not.toContain('## Personal Notes');
    expect(renderMeetingMarkdown(parse(text))).toBe(text);
  });

  it('replaces newlines in the single-line fields (B3)', () => {
    const text = renderMeetingMarkdown(
      meeting({
        title: 'Line one\n---\nline two',
        audioFilePath: 'C:\\a\r\nb.wav',
        summaryProvider: 'x\ny',
      }),
    );
    const back = parse(text);
    expect(back.title).toBe('Line one --- line two');
    expect(back.audioFilePath).toBe('C:\\a  b.wav');
    expect(back.summaryProvider).toBe('x y');
    expect(back.id).toBe(ID);
  });

  it('replaces newlines in optional fields and attendee names', () => {
    const back = parse(
      renderMeetingMarkdown(meeting({ calendarId: 'a\nb', attendees: ['Ana\r\nPerez', 'Luis'] })),
    );
    expect(back.calendarId).toBe('a b');
    expect(back.attendees).toEqual(['Ana  Perez', 'Luis']);
  });

  it('keeps action item text on one line (B22)', () => {
    const back = parse(
      renderMeetingMarkdown(
        meeting({ actionItems: [{ text: 'one\n## Summary\ntwo', isDone: false }] }),
      ),
    );
    expect(back.actionItems).toEqual([{ text: 'one ## Summary two', isDone: false }]);
    expect(back.summary).toBeNull();
  });
});

describe('header escaping', () => {
  it.each([
    '## Brief',
    '## Transcript',
    '## Summary',
    '## Action Items',
    '## Jev',
    '## Personal Notes',
    '## Follow-up',
    '## Project plan',
  ])('keeps a %s line inside notes and invents no section', (header) => {
    const notes = `Before\n${header}\nAfter`;
    const text = renderMeetingMarkdown(meeting({ notes }));
    expect(text).toContain('headerEscaping: 1\n');
    expect(text).toContain(`\n${header} ##\n`);
    const back = parse(text);
    expect(back.notes).toBe(notes);
    expect(back.summary).toBeNull();
    expect(back.actionItems).toEqual([]);
    expect(back.jevAnalysis).toBeNull();
  });

  it('protects header lines in every text section', () => {
    const record = meeting({
      brief: 'b\n## Summary\nb',
      transcript: 't\n## Brief\nt',
      summary: 's\n## Jev\ns',
      notes: 'n\n## Transcript\nn',
      followUp: 'f\n## Project plan\nf',
      projectPlan: 'p\n## Follow-up\np',
    });
    expect(parse(renderMeetingMarkdown(record))).toEqual({ ...record, sourcePath: 'x.md' });
  });

  it('keeps a header line that trimming exposes', () => {
    const record = meeting({ notes: '\n\n## Summary\nrest\n' });
    expect(parse(renderMeetingMarkdown(record)).notes).toBe('## Summary\nrest');
  });

  it('protects header lines in CRLF bodies', () => {
    const record = meeting({ notes: 'a\r\n## Summary\r\nb' });
    const back = parse(renderMeetingMarkdown(record));
    expect(back.notes).toBe('a\n## Summary\nb');
    expect(back.summary).toBeNull();
  });

  it('adds a second layer to content that already looks escaped', () => {
    const record = meeting({ notes: 'A\n## Summary\nB\n## Summary ##\nC' });
    const text = renderMeetingMarkdown(record);
    expect(text).toContain('\n## Summary ##\nB\n## Summary ## ##\nC');
    expect(parse(text).notes).toBe(record.notes);
  });

  it.each(['## Summary ##', 'Only a closed heading\n## Summary ##\nEnd', 'x ##'])(
    'leaves %j alone when no real header line exists',
    (notes) => {
      const text = renderMeetingMarkdown(meeting({ notes }));
      expect(text).not.toContain('headerEscaping');
      expect(parse(text).notes).toBe(notes);
    },
  );

  it('reads a legacy file without the key literally and splits the old way', () => {
    const text =
      `---\nid: ${ID}\ntitle: Standup\nrecordedAt: 2026-09-01T12:00:00.0000000+00:00\naudioFilePath: \n---\n` +
      '\n## Personal Notes\n\nBefore\n## Summary\nAfter\n';
    const back = parse(text);
    expect(back.notes).toBe('Before');
    expect(back.summary).toBe('After');
  });
});

describe('parse', () => {
  const head = `---\nid: ${ID}\nrecordedAt: 2026-09-01T12:00:00Z\n`;

  it('rejects a missing opening delimiter and a missing id', () => {
    expect(() => parse('id: x\n')).toThrow(MeetingFormatError);
    expect(() => parse('---\ntitle: x\nrecordedAt: 2026-09-01T12:00:00Z\n---\n')).toThrow(
      MeetingFormatError,
    );
  });

  it('rejects a missing closing delimiter, a bad id and a bad date', () => {
    expect(() => parse(head)).toThrow(MeetingFormatError);
    expect(() => parse('---\nid: nope\nrecordedAt: 2026-09-01T12:00:00Z\n---\n')).toThrow(
      MeetingFormatError,
    );
    expect(() => parse(`---\nid: ${ID}\nrecordedAt: soon\n---\n`)).toThrow(MeetingFormatError);
    expect(() => parse(`---\nid: ${ID}\n---\n`)).toThrow(MeetingFormatError);
  });

  it('requires the first line to be exactly ---', () => {
    expect(() => parse(` ---\nid: ${ID}\n---\n`)).toThrow(MeetingFormatError);
  });

  it('strips a BOM and reads CRLF files', () => {
    const text = `\uFEFF${head}title: Hi\n---\n\n## Summary\n\nbody\n`.replace(/\n/g, '\r\n');
    const back = parse(text);
    expect(back.title).toBe('Hi');
    expect(back.summary).toBe('body');
    expect(back.recordedAt).toBe('2026-09-01T12:00:00.0000000+00:00');
  });

  it('ignores lines without a colon, lets later duplicates win, trims keys and values', () => {
    const back = parse(`${head}garbage line\n title :  First \ntitle: Second\nfolderId\n---\n`);
    expect(back.title).toBe('Second');
    expect(back.folderId).toBeNull();
  });

  it('keeps colons inside values and reads a key without a value as empty', () => {
    const back = parse(`${head}title: a: b: c\njoinUrl:\naudioFilePath:\n---\n`);
    expect(back.title).toBe('a: b: c');
    expect(back.joinUrl).toBeNull();
    expect(back.audioFilePath).toBe('');
  });

  it('reads a recordedAt without an offset as local time', () => {
    const back = parse(`---\nid: ${ID}\nrecordedAt: 2026-09-01T12:00:00\n---\n`);
    expect(back.recordedAt).toMatch(/^2026-09-01T12:00:00\.0000000[+-]\d{2}:\d{2}$/);
  });

  it('ignores an unparsable endedAt and an invalid folderId', () => {
    const back = parse(`${head}endedAt: later\nfolderId: nope\n---\n`);
    expect(back.endedAt).toBeNull();
    expect(back.folderId).toBeNull();
  });

  it('accepts any GUID text form for id', () => {
    const back = parse(
      `---\nid: {ABCDEF12-1111-2222-3333-444444444444}\nrecordedAt: 2026-09-01T12:00:00Z\n---\n`,
    );
    expect(back.id).toBe('abcdef12-1111-2222-3333-444444444444');
  });

  it('falls back to the sibling wav when audioFilePath is blank or missing', () => {
    const exists = { fileExists: (p: string) => p === 'C:\\lib\\Inbox\\a.wav' };
    const blank = parseMeetingMarkdown(
      'C:\\lib\\Inbox\\a.md',
      `${head}audioFilePath: \n---\n`,
      exists,
    );
    expect(blank.audioFilePath).toBe('C:\\lib\\Inbox\\a.wav');
    const stale = parseMeetingMarkdown(
      'C:\\lib\\Inbox\\a.md',
      `${head}audioFilePath: D:\\gone.wav\n---\n`,
      exists,
    );
    expect(stale.audioFilePath).toBe('C:\\lib\\Inbox\\a.wav');
    const keep = parse(`${head}audioFilePath: D:\\gone.wav\n---\n`);
    expect(keep.audioFilePath).toBe('D:\\gone.wav');
  });

  it('splits attendees on " | " and drops empties', () => {
    expect(parse(`${head}attendees: Ana |  | Luis Gomez\n---\n`).attendees).toEqual([
      'Ana',
      'Luis Gomez',
    ]);
  });

  it('returns null for missing or empty sections', () => {
    const back = parse(`${head}---\n\n## Summary\n\n\n\n## Transcript\n\nx\n`);
    expect(back.summary).toBeNull();
    expect(back.transcript).toBe('x');
    expect(back.brief).toBeNull();
  });

  it('parses action items with the spec regex and ignores other lines', () => {
    const back = parse(
      `${head}---\n\n## Action Items\n\n- [ ] one\n  - [X]   two  \n- [ ]\nnot an item\n-[ ] bad\n`,
    );
    expect(back.actionItems).toEqual([
      { text: 'one', isDone: false },
      { text: 'two', isDone: true },
    ]);
  });

  it('reads Jev JSON with raw or escaped non-ASCII and any property case', () => {
    const body =
      '{"MeetingType":"r\\u00E9union","model":"m","actionItems":[{"text":"ñ","relation":"r"}]}';
    const back = parse(`${head}---\n\n## Jev\n\n${body}\n`);
    expect(back.jevAnalysis?.meetingType).toBe('réunion');
    expect(back.jevAnalysis?.actionItems[0]).toEqual({
      text: 'ñ',
      relation: 'r',
      confidence: null,
    });
  });

  it('raises a format error for a Jev block that is not JSON (the file is skipped, B4)', () => {
    expect(() => parse(`${head}---\n\n## Jev\n\n{oops\n`)).toThrow(MeetingFormatError);
  });

  it('sets sourcePath from the path read', () => {
    expect(parse(`${head}---\n`, 'C:\\lib\\x.md').sourcePath).toBe('C:\\lib\\x.md');
  });
});
