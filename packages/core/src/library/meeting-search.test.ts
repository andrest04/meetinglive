import { describe, expect, it, vi } from 'vitest';
import { InMemoryMeetingRepository } from './in-memory-library';
import type { MeetingRecord } from './meeting';
import {
  MAX_ORIGINAL_SNIPPETS,
  bestField,
  foldSearchText,
  meetingSearchText,
  searchMeetings,
  searchSnippet,
  type MeetingBody,
  type MeetingSearchText,
} from './meeting-search';
import { foldedWords } from './text-fold';

const record = (id: string, patch: Partial<MeetingRecord> = {}): MeetingRecord => ({
  id,
  title: id,
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
});

const folded = (patch: Partial<MeetingSearchText>): MeetingSearchText => ({
  title: '',
  summary: '',
  notes: '',
  transcript: '',
  ...patch,
});

async function search(
  records: readonly MeetingRecord[],
  query: string,
  isStale: () => boolean = () => false,
) {
  const repository = new InMemoryMeetingRepository();
  for (const r of records) repository.records.set(r.id, r);
  return searchMeetings({ bodies: repository.bodies(() => true), query, isStale });
}

describe('meetingSearchText', () => {
  it('files what the Summary tab shows under summary, and personal text under notes', () => {
    const text = meetingSearchText(
      record('m', {
        title: 'Roadmap',
        summary: 'Agreed to ship',
        actionItems: [{ text: 'Call the client', isDone: false }],
        followUp: 'Send the recap',
        projectPlan: 'Phase two',
        notes: 'Remember the budget',
        brief: 'Prepare slides',
        attendees: ['María'],
        transcript: 'Recorded 2026-09-01\n[00:01.00-00:02.00] [ Speaker-1 ] Spoken text',
      }),
    );
    expect(text.title).toBe('Roadmap');
    expect(text.summary.split('\n')).toEqual([
      'Agreed to ship',
      'Call the client',
      'Send the recap',
      'Phase two',
    ]);
    expect(text.notes.split('\n')).toEqual(['Remember the budget', 'Prepare slides', 'María']);
    expect(text.transcript).toBe('Spoken text');
  });

  it('treats missing sections as empty text', () => {
    expect(meetingSearchText(record('m', { title: 'T' }))).toEqual({
      title: 'T',
      summary: '',
      notes: '',
      transcript: '',
    });
  });
});

describe('bestField', () => {
  it('names the field holding the most words, the earlier field on a tie', () => {
    const text = folded({ title: 'plan', summary: 'plan budget', transcript: 'plan budget' });
    expect(bestField(text, ['plan', 'budget'])).toBe('summary');
    expect(bestField(text, ['plan'])).toBe('title');
  });

  it('lets the words be spread across fields', () => {
    expect(bestField(folded({ title: 'roadmap', notes: 'budget' }), ['roadmap', 'budget'])).toBe(
      'title',
    );
  });

  it('is null when any word is missing everywhere', () => {
    expect(bestField(folded({ title: 'roadmap' }), ['roadmap', 'budget'])).toBeNull();
  });
});

describe('searchSnippet', () => {
  it('shows the original text around the first word, with accents and case intact', () => {
    expect(searchSnippet('Primera línea\nRevisión del AÑO pasado\nÚltima', ['ano'])).toBe(
      'Revisión del AÑO pasado',
    );
  });

  it('keeps the word in view in a long line and marks what was cut', () => {
    const line = `${'antes '.repeat(50)}objetivo${' después'.repeat(50)}`;
    const snippet = searchSnippet(line, ['objetivo']) ?? '';
    expect(snippet).toContain('objetivo');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(142);
  });

  it('drops Markdown markers', () => {
    expect(searchSnippet('## El **plan** nuevo', ['plan'])).toBe('El plan nuevo');
  });

  it('is null when the word is not there', () => {
    expect(searchSnippet('nada', ['plan'])).toBeNull();
  });
});

describe('searchMeetings', () => {
  it('finds a word in any field, without regard to case or accents, newest first', async () => {
    const hits = await search(
      [
        record('old', {
          recordedAt: '2026-01-01T10:00:00+00:00',
          transcript: '[00:01.00-00:02.00] [ Speaker-1 ] el año fiscal',
        }),
        record('new', { recordedAt: '2026-03-01T10:00:00+00:00', notes: 'Cierre del AÑO' }),
        record('none', { summary: 'Otro tema' }),
      ],
      'ano',
    );
    expect(hits).toEqual([
      { meetingId: 'new', field: 'notes', snippet: 'Cierre del AÑO' },
      { meetingId: 'old', field: 'transcript', snippet: 'el año fiscal' },
    ]);
  });

  it('does not match stamps or speaker tags', async () => {
    const records = [record('m', { transcript: '[00:01.00-00:02.00] [ Speaker-1 ] hola' })];
    expect(await search(records, 'speaker')).toEqual([]);
    expect(await search(records, '00:01')).toEqual([]);
  });

  it('a title hit needs no snippet: the list already shows its own', async () => {
    expect(await search([record('m', { title: 'Roadmap' })], 'roadmap')).toEqual([
      { meetingId: 'm', field: 'title', snippet: null },
    ]);
  });

  it('needs at least two characters', async () => {
    const records = [record('m', { title: 'Roadmap' })];
    expect(await search(records, 'r')).toEqual([]);
    expect(await search(records, '  r  ')).toEqual([]);
    expect(await search(records, '')).toEqual([]);
  });

  it(`re-reads originals only for the newest ${String(MAX_ORIGINAL_SNIPPETS)} hits`, async () => {
    const original = vi.fn(() => Promise.resolve(folded({ summary: 'Plan' })));
    const count = MAX_ORIGINAL_SNIPPETS + 5;
    async function* bodies(): AsyncGenerator<MeetingBody> {
      await Promise.resolve();
      for (let index = 0; index < count; index += 1) {
        yield {
          item: {
            id: String(index),
            title: '',
            recordedAt: `2026-01-01T10:00:00+00:00`.replace('2026', String(2000 + index)),
            endedAt: null,
            folderId: null,
            snippet: '',
            hasSummary: true,
            hasTranscript: false,
            busy: false,
          },
          folded: folded({ summary: 'plan' }),
          original,
        };
      }
    }
    const hits =
      (await searchMeetings({ bodies: bodies(), query: 'plan', isStale: () => false })) ?? [];
    expect(hits).toHaveLength(count);
    expect(original).toHaveBeenCalledTimes(MAX_ORIGINAL_SNIPPETS);
    expect(hits[0]).toEqual({ meetingId: String(count - 1), field: 'summary', snippet: 'Plan' });
    expect(hits[count - 1]).toEqual({ meetingId: '0', field: 'summary', snippet: null });
  });

  it('falls back to no snippet when the file went away before it could be re-read', async () => {
    async function* bodies(): AsyncGenerator<MeetingBody> {
      await Promise.resolve();
      yield {
        item: {
          id: 'm',
          title: '',
          recordedAt: '2026-01-01T10:00:00+00:00',
          endedAt: null,
          folderId: null,
          snippet: '',
          hasSummary: true,
          hasTranscript: false,
          busy: false,
        },
        folded: folded({ summary: 'plan' }),
        original: () => Promise.resolve(null),
      };
    }
    expect(await searchMeetings({ bodies: bodies(), query: 'plan', isStale: () => false })).toEqual(
      [{ meetingId: 'm', field: 'summary', snippet: null }],
    );
  });

  it('stops between files when a newer search replaced it, and closes the source', async () => {
    let read = 0;
    let closed = false;
    async function* bodies(): AsyncGenerator<MeetingBody> {
      try {
        await Promise.resolve();
        for (let index = 0; index < 100; index += 1) {
          read += 1;
          yield {
            item: {
              id: String(index),
              title: 'plan',
              recordedAt: '2026-01-01T10:00:00+00:00',
              endedAt: null,
              folderId: null,
              snippet: '',
              hasSummary: false,
              hasTranscript: false,
              busy: false,
            },
            folded: folded({ title: 'plan' }),
            original: () => Promise.resolve(null),
          };
        }
      } finally {
        closed = true;
      }
    }
    const result = await searchMeetings({
      bodies: bodies(),
      query: 'plan',
      isStale: () => read >= 3,
    });
    expect(result).toBeNull();
    expect(read).toBe(3);
    expect(closed).toBe(true);
  });
});

describe('foldSearchText', () => {
  it('folds every field and keeps their lengths', () => {
    const text = { title: 'Año', summary: 'ÉL', notes: 'Ñu', transcript: 'Plan' };
    expect(foldSearchText(text)).toEqual({
      title: 'ano',
      summary: 'el',
      notes: 'nu',
      transcript: 'plan',
    });
    expect(foldedWords('AÑO')).toEqual(['ano']);
  });
});
