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

describe('snippetFromMarkdown, B15 marker rule', () => {
  it('keeps underscores and asterisks inside words, URLs and file names', () => {
    expect(snippetFromMarkdown('See snake_case and my_file_name.txt')).toBe(
      'See snake_case and my_file_name.txt',
    );
    expect(snippetFromMarkdown('Open https://example.com/a_b_c?x=1*2 now')).toBe(
      'Open https://example.com/a_b_c?x=1*2 now',
    );
    expect(snippetFromMarkdown('math a*b and 2 * 3 * 4')).toBe('math a*b and 2 * 3 * 4');
  });

  it('strips emphasis markers that wrap text', () => {
    expect(snippetFromMarkdown('*one* _two_ **three** __four__ `five` ```six```')).toBe(
      'one two three four five six',
    );
  });

  it('keeps underscores inside backticked code', () => {
    expect(snippetFromMarkdown('call `do_it_now` please')).toBe('call do_it_now please');
  });
});

describe('snippetFromMarkdown, B10 surrogate-safe cut', () => {
  it('never leaves half of an emoji at the 140 boundary', () => {
    const result = snippetFromMarkdown(`${'x'.repeat(139)}\u{1F600} tail`);
    expect(result).toBe(`${'x'.repeat(139)}…`);
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

  it('S6: a spoken line starting with "# " is still read as a heading and dropped, on purpose', () => {
    const transcript = ['[00:00.00-00:03.00] # one', '[00:03.00-00:05.00] kept words'].join('\n');
    expect(meetingSnippet(null, transcript)).toBe('kept words');
  });

  it('is empty when the transcript has only headers', () => {
    expect(meetingSnippet(null, 'Recorded 2026-09-01 12:00\nEnded 2026-09-01 12:30')).toBe('');
  });

  it('is empty when both are empty', () => {
    expect(meetingSnippet(null, null)).toBe('');
    expect(meetingSnippet('', '')).toBe('');
  });

  it('keeps list bullets, blockquote marks and link syntax, as WinUI does (B15 decision)', () => {
    expect(snippetFromMarkdown('- foo [x](http://y)')).toBe('- foo [x](http://y)');
    expect(snippetFromMarkdown('> quoted')).toBe('> quoted');
  });
});
