import { describe, expect, it } from 'vitest';
import { parseActionItems, renderActionItems } from './action-items';
import { splitSummaryResponse } from './summary-splitter';

describe('splitSummaryResponse', () => {
  it('splits on both headers', () => {
    const r = splitSummaryResponse(
      '## Summary\nTalked.\n\n## Action Items\n- [ ] Send mail\n- [x] Book room\n',
    );
    expect(r.summaryMarkdown).toBe('Talked.');
    expect(r.actionItems).toEqual([
      { text: 'Send mail', isDone: false },
      { text: 'Book room', isDone: true },
    ]);
    expect(r.suggestedTitle).toBeNull();
  });

  it('falls back to the first checkbox line without headers', () => {
    const r = splitSummaryResponse('Notes here.\n- [ ] Do it\n');
    expect(r.summaryMarkdown).toBe('Notes here.');
    expect(r.actionItems).toEqual([{ text: 'Do it', isDone: false }]);
  });

  it('keeps the whole response as summary with no action items', () => {
    const r = splitSummaryResponse('Just prose.\nMore prose.');
    expect(r.summaryMarkdown).toBe('Just prose.\nMore prose.');
    expect(r.actionItems).toEqual([]);
  });

  it('returns an empty list for an empty action section', () => {
    const r = splitSummaryResponse('## Summary\nBody\n\n## Action Items\n');
    expect(r.summaryMarkdown).toBe('Body');
    expect(r.actionItems).toEqual([]);
  });

  it('extracts the title and strips it from the body', () => {
    const r = splitSummaryResponse(
      '## Title\nBudget review\n\n## Summary\nBody\n\n## Action Items\n- [ ] A',
    );
    expect(r.suggestedTitle).toBe('Budget review');
    expect(r.summaryMarkdown).toBe('Body');
    expect(r.actionItems).toHaveLength(1);
  });

  it('gives null title and an unchanged body when there is no title', () => {
    const r = splitSummaryResponse('## Summary\nBody\n\n## Action Items\n- [ ] A');
    expect(r.suggestedTitle).toBeNull();
    expect(r.summaryMarkdown).toBe('Body');
  });

  it('joins blank-separated title lines with one space', () => {
    const r = splitSummaryResponse('## Title\n  First part  \n\n  second part\n## Summary\nB');
    expect(r.suggestedTitle).toBe('First part second part');
  });

  it('keeps wrapping quotes for later normalization', () => {
    const r = splitSummaryResponse('## Title\n"Quoted"\n## Summary\nB');
    expect(r.suggestedTitle).toBe('"Quoted"');
  });

  it('gives a null title for an empty title block', () => {
    const r = splitSummaryResponse('## Title\n\n## Summary\nB');
    expect(r.suggestedTitle).toBeNull();
    expect(r.summaryMarkdown).toBe('B');
  });

  it('normalizes CRLF', () => {
    const r = splitSummaryResponse(
      '## Title\r\nT\r\n## Summary\r\nBody\r\n## Action Items\r\n- [ ] A\r\n',
    );
    expect(r.suggestedTitle).toBe('T');
    expect(r.summaryMarkdown).toBe('Body');
    expect(r.actionItems).toEqual([{ text: 'A', isDone: false }]);
  });

  describe('B25 tolerance', () => {
    it('strips a wrapping code fence', () => {
      const r = splitSummaryResponse(
        '```markdown\n## Summary\nBody\n\n## Action Items\n- [ ] A\n```',
      );
      expect(r.summaryMarkdown).toBe('Body');
      expect(r.actionItems).toEqual([{ text: 'A', isDone: false }]);
    });

    it('strips a bare wrapping fence', () => {
      expect(splitSummaryResponse('```\nBody\n```').summaryMarkdown).toBe('Body');
    });

    it('does not strip an unclosed fence', () => {
      expect(splitSummaryResponse('```js\ncode').summaryMarkdown).toBe('```js\ncode');
    });

    it('accepts any case of the three headers', () => {
      const r = splitSummaryResponse('## TITLE\nT\n## summary\nBody\n## Action items\n- [ ] A');
      expect(r.suggestedTitle).toBe('T');
      expect(r.summaryMarkdown).toBe('Body');
      expect(r.actionItems).toHaveLength(1);
    });

    it('accepts a bold Action Items header', () => {
      const r = splitSummaryResponse('Body\n\n**Action Items**\n- [ ] A');
      expect(r.summaryMarkdown).toBe('Body');
      expect(r.actionItems).toEqual([{ text: 'A', isDone: false }]);
    });

    it('ends a title block at the bold action header', () => {
      const r = splitSummaryResponse('## Title\nT\n**Action Items**\n- [ ] A');
      expect(r.suggestedTitle).toBe('T');
      expect(r.actionItems).toHaveLength(1);
    });
  });
});

describe('parseActionItems', () => {
  it('returns an empty list for blank input', () => {
    expect(parseActionItems('')).toEqual([]);
    expect(parseActionItems('  \n ')).toEqual([]);
    expect(parseActionItems(null)).toEqual([]);
  });

  it('marks x and X as done and trims text', () => {
    expect(parseActionItems('- [x]   a  \n- [X] b\n- [ ] c')).toEqual([
      { text: 'a', isDone: true },
      { text: 'b', isDone: true },
      { text: 'c', isDone: false },
    ]);
  });

  it('ignores non-matching lines, empty boxes and boxes without text', () => {
    expect(parseActionItems('prose\n- [] a\n- [ ]\n- [ ]   \n1. [ ] n')).toEqual([]);
  });

  it('B26: accepts * and + bullets and flexible spacing', () => {
    expect(parseActionItems('* [ ] a\n+ [x] b\n  -   [ ]   c\n-[ ] d')).toEqual([
      { text: 'a', isDone: false },
      { text: 'b', isDone: true },
      { text: 'c', isDone: false },
      { text: 'd', isDone: false },
    ]);
  });

  it('B26: ignores numbered lists', () => {
    expect(parseActionItems('1. [ ] a\n2) [x] b')).toEqual([]);
  });

  it('handles CRLF', () => {
    expect(parseActionItems('- [ ] a\r\n- [x] b\r\n')).toHaveLength(2);
  });
});

describe('renderActionItems', () => {
  it('renders empty as an empty string', () => {
    expect(renderActionItems([])).toBe('');
  });

  it('renders lowercase x and one newline per item', () => {
    expect(
      renderActionItems([
        { text: 'a', isDone: true },
        { text: 'b', isDone: false },
      ]),
    ).toBe('- [x] a\n- [ ] b\n');
  });

  it('round-trips through the parser', () => {
    const items = [
      { text: 'a', isDone: true },
      { text: 'b', isDone: false },
    ];
    expect(parseActionItems(renderActionItems(items))).toEqual(items);
  });
});
