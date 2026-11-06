// @vitest-environment jsdom
import { parseMeetingMarkdown, renderMeetingMarkdown, type MeetingRecord } from '@vozella/core';
import { describe, expect, it } from 'vitest';
import { canonicalNotes, normalizeNotes, notesForSave } from './notepad-markdown';

/** The text the editor stores for `input`, without the blank lines it ends blocks with. */
const stored = (input: string): string => canonicalNotes(input).trim();

/** Inputs whose stored form is the input itself. */
const EXACT: readonly (readonly [string, string])[] = [
  ['paragraph', 'Call with the client about the budget.'],
  ['two paragraphs', 'First paragraph.\n\nSecond paragraph.'],
  ['soft break', 'line one\nline two'],
  ['hard break', 'line one  \nline two'],
  ['heading 1', '# Title'],
  ['heading 2', '## Decisions'],
  ['heading 3', '### Owners'],
  ['bullet list', '- one\n- two\n- three'],
  ['ordered list', '1. one\n2. two\n3. three'],
  ['nested bullets', '- one\n  - nested\n    - deeper\n- two'],
  ['ordered in bullet', '- one\n  1. first\n  2. second\n- two'],
  ['bullet in ordered', '1. one\n   - a\n   - b\n2. two'],
  ['task list', '- [ ] send the deck\n- [x] book the room'],
  ['nested task list', '- [ ] parent\n  - [x] child'],
  ['bold', 'a **bold** word'],
  ['italic', 'an *italic* word'],
  ['strike', 'a ~~struck~~ word'],
  ['bold italic nesting', '**bold *and italic* text**'],
  ['italic around bold', '*italic **and bold** text*'],
  ['inline code', 'run `pnpm check` now'],
  ['fenced code with language', '```ts\nconst a = 1;\n```'],
  ['fenced code without language', '```\nplain\n```'],
  ['code with blank line', '```\na\n\nb\n```'],
  ['link', 'see [the plan](https://example.com/plan) first'],
  ['blockquote', '> quoted line'],
  ['multi-line blockquote', '> one\n> two'],
  ['horizontal rule', 'above\n\n---\n\nbelow'],
  ['escaped asterisk', 'cost \\* 3'],
  ['escaped underscore', 'snake\\_case'],
  ['escaped brackets', 'a \\[b\\] c'],
  ['escaped backtick', 'a \\` b'],
  ['unicode', 'Zażółć gęślą jaźń, 日本語, العربية'],
  ['emoji', 'Ship it 🚀 and 👍🏽 and 👨‍👩‍👧'],
  ['spanish accents', 'Reunión con José: ¿qué decidimos? Mañana, canción, pingüino.'],
];

describe('notes Markdown round trip: exact text', () => {
  it.each(EXACT)('keeps %s unchanged', (_name, input) => {
    expect(stored(input)).toBe(input);
  });

  it.each(EXACT)('is idempotent for %s', (_name, input) => {
    const once = canonicalNotes(input);
    expect(canonicalNotes(once)).toBe(once);
  });
});

describe('notes Markdown round trip: normalization', () => {
  it('turns CRLF and lone CR into LF before loading', () => {
    expect(normalizeNotes('a\r\nb\rc')).toBe('a\nb\nc');
    expect(stored('one\r\n\r\ntwo\r\n\r\n- a\r\n- b')).toBe('one\n\ntwo\n\n- a\n- b');
    expect(canonicalNotes('a\r\nb')).not.toContain('\r');
  });

  it('trims trailing whitespace at save', () => {
    expect(notesForSave('word  ')).toBe('word');
  });

  it('keeps characters that Markdown reads as syntax', () => {
    const text = 'a * b _ c # d [ e ] f | g ` h';
    const result = stored(text);
    expect(stored(result)).toBe(result);
    expect(canonicalNotes(result)).toBe(canonicalNotes(text));
  });

  it('keeps a backslash that is part of the text', () => {
    const result = stored('path C:\\temp\\new');
    expect(stored(result)).toBe(result);
    expect(result).toContain('temp');
  });

  // Three full TipTap round trips of a 100k-char document take ~1-5 s depending on the machine
  // and suite load; the default 5 s timeout made it flaky in CI. It checks output, not speed.
  it('is idempotent for a long mixed document', () => {
    const paragraph =
      'Reunión **importante** con *José* sobre `build` y [plan](https://e.com) 🚀. '.repeat(40);
    const long = Array.from({ length: 150 }, (_, i) => `${paragraph}${i}`).join('\n\n');
    expect(long.length).toBeGreaterThan(100_000);
    const once = canonicalNotes(long);
    expect(canonicalNotes(once)).toBe(once);
    expect(stored(long)).toBe(long);
  }, 30_000);

  it('keeps the order of a heading, list, quote and code in one document', () => {
    const doc = '# Plan\n\n- [ ] one\n- [x] two\n\n> why\n\n```js\nrun();\n```\n\nEnd.';
    expect(stored(doc)).toBe(doc);
  });
});

describe('notes Markdown: empty and blank', () => {
  it.each([[''], [' '], ['\n'], ['  \n\n  \t'], ['\r\n\r\n']])('saves %j as null', (input) => {
    expect(notesForSave(input)).toBeNull();
  });

  it('saves trimmed text', () => {
    expect(notesForSave('  \n hello \n\n')).toBe('hello');
  });
});

describe('plain text written by the WinUI app', () => {
  it.each([
    ['one line', 'Follow up with Ana on Friday'],
    ['lines', 'Agenda\nBudget\nNext steps'],
    ['paragraphs', 'First thought\n\nSecond thought'],
    ['accents and emoji', 'Reunión en Medellín, café ☕'],
  ])('loads %s unchanged', (_name, text) => {
    expect(stored(text)).toBe(text);
  });
});

describe('accepted lossy cases', () => {
  // The editor stores Markdown, so text only changes where several Markdown spellings mean the
  // same document. The meaning stays; the spelling is the editor's. Documented in the ledger.
  it.each([
    ['star bullets become dashes', '* a\n* b', '- a\n- b'],
    ['underscore emphasis becomes asterisks', '_a_ and __b__', '*a* and **b**'],
    ['setext headings become hashes', 'Title\n=====', '# Title'],
    ['indented code becomes fenced', '    code line', '```\ncode line\n```'],
    ['closing hashes are dropped', '## Heading ##', '## Heading'],
    ['numbering restarts from the first number', '1. a\n1. b\n1. c', '1. a\n2. b\n3. c'],
    ['a plus bullet becomes a dash', '+ a\n+ b', '- a\n- b'],
  ])('%s', (_name, input, expected) => {
    expect(stored(input)).toBe(expected);
  });

  it('keeps raw HTML out of the document', () => {
    const result = stored('<b>x</b>');
    expect(stored(result)).toBe(result);
  });
});

const RECORD: MeetingRecord = {
  id: '11111111-1111-1111-1111-111111111111',
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
};

const throughFile = (notes: string | null): string | null => {
  const text = renderMeetingMarkdown({ ...RECORD, notes });
  return parseMeetingMarkdown('x.md', text, { fileExists: () => false }).notes;
};

describe('notes inside the meeting file', () => {
  it.each([
    ['## Summary'],
    ['## Transcript'],
    ['## Personal Notes'],
    ['## Action Items'],
    ['## Brief'],
    ['## Follow-up'],
    ['## Project plan'],
    ['## Jev'],
    ['## Summary ##'],
    ['intro\n\n## Summary\n\nafter'],
    ['## Transcript\n\n- [x] done'],
  ])('survives the real formatter and parser: %j', (notes) => {
    const saved = notesForSave(notes);
    expect(saved).not.toBeNull();
    expect(throughFile(saved)).toBe(saved);
  });

  it('survives for every editor-stored sample', () => {
    for (const [, input] of EXACT) {
      const saved = notesForSave(input);
      expect(throughFile(saved)).toBe(saved);
    }
  });

  it('reads the saved text back into the editor as the same document', () => {
    const saved = notesForSave('## Summary\n\n- [ ] ship\n\n> note');
    expect(canonicalNotes(throughFile(saved) ?? '').trim()).toBe(saved);
  });

  it('keeps blank notes out of the file', () => {
    expect(renderMeetingMarkdown({ ...RECORD, notes: notesForSave('  \n ') })).not.toContain(
      'Personal Notes',
    );
  });
});
