import { describe, expect, it } from 'vitest';
import {
  SNIPPET_MAX_LENGTH,
  committedLineBody,
  meetingSnippet,
  snippetFromMarkdown,
} from './snippet';

describe('snippetFromMarkdown', () => {
  it('returns empty for blank text', () => {
    expect(snippetFromMarkdown('')).toBe('');
    expect(snippetFromMarkdown('  \n ')).toBe('');
  });

  it('strips headings, emphasis and backticks, preferring body text', () => {
    expect(snippetFromMarkdown('# Title\n**Bold** and `code` and __under__ and *it*')).toBe(
      'Bold and code and under and it',
    );
  });

  it('keeps heading text when there is nothing else', () => {
    expect(snippetFromMarkdown('## Only a heading\n### Another')).toBe('Only a heading Another');
  });

  it('collapses whitespace and joins lines with one space', () => {
    expect(snippetFromMarkdown('a   b\r\n\r\n  c\td')).toBe('a b c d');
  });

  it('treats "#tag" without a space as body text', () => {
    expect(snippetFromMarkdown('#tag')).toBe('#tag');
  });

  it('truncates to 140 characters plus an ellipsis', () => {
    const result = snippetFromMarkdown('x'.repeat(500));
    expect(result).toHaveLength(SNIPPET_MAX_LENGTH + 1);
    expect(result.endsWith('…')).toBe(true);
  });

  it('leaves short text unchanged', () => {
    expect(snippetFromMarkdown('short')).toBe('short');
    expect(snippetFromMarkdown('x'.repeat(140))).toBe('x'.repeat(140));
  });
});

describe('committedLineBody', () => {
  it('drops the stamp and the speaker tag', () => {
    expect(committedLineBody('[00:03.00-00:05.50] [ Speaker-2 ] Hello there')).toBe('Hello there');
    expect(committedLineBody('[00:03.00-00:05.50] Hello')).toBe('Hello');
  });

  it('keeps a line with no valid stamp, trimmed', () => {
    expect(committedLineBody('  plain text ')).toBe('plain text');
    expect(committedLineBody('[1:03.00-00:05.50] short minutes')).toBe(
      '[1:03.00-00:05.50] short minutes',
    );
  });

  it('accepts three-digit minutes and rejects bad seconds', () => {
    expect(committedLineBody('[100:03.00-100:05.50] long')).toBe('long');
    expect(committedLineBody('[00:60.00-00:61.00] bad')).toBe('[00:60.00-00:61.00] bad');
  });

  it('is empty for empty input', () => {
    expect(committedLineBody('')).toBe('');
  });
});

describe('meetingSnippet', () => {
  it('prefers the summary over the transcript', () => {
    expect(meetingSnippet('Summary text', '[00:00.00-00:01.00] spoken')).toBe('Summary text');
  });

  it('falls back to the transcript body without headers, stamps, or speaker tags', () => {
    const transcript = [
      'Recorded 2026-09-01 12:00',
      '[00:00.00-00:03.00] [ Speaker-1 ] Hello team',
      '[00:03.00-00:05.00] Second line',
      'Ended 2026-09-01 12:30',
    ].join('\r\n');
    expect(meetingSnippet(null, transcript)).toBe('Hello team Second line');
    expect(meetingSnippet('   ', transcript)).toBe('Hello team Second line');
  });

  it('is empty when both are empty', () => {
    expect(meetingSnippet(null, null)).toBe('');
    expect(meetingSnippet('', '')).toBe('');
  });
});
