import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, safeHref } from './markdown';

describe('safeHref', () => {
  it('allows only http and https', () => {
    expect(safeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('  JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<b>x</b>')).toBeNull();
    expect(safeHref('file:///c:/secret')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});

describe('parseInline', () => {
  it('reads bold, italic, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.io)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.io/', children: [{ type: 'text', text: 'e' }] },
    ]);
  });

  it('keeps only the label of a link with an unsafe scheme', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ type: 'text', text: 'click' }]);
  });

  it('leaves an unclosed marker as text', () => {
    expect(parseInline('2 * 3 and **open')).toEqual([{ type: 'text', text: '2 * 3 and **open' }]);
  });

  it('does not read markup inside code', () => {
    expect(parseInline('`**x**`')).toEqual([{ type: 'code', text: '**x**' }]);
  });
});

describe('parseBlocks', () => {
  it('reads headings, paragraphs and lists', () => {
    const blocks = parseBlocks(
      '### Key points\n\nFirst line\ncontinues\n\n- one\n- two\n\n1. a\n2. b\n',
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 3 });
    expect(blocks[1]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text', text: 'First line continues' }],
    });
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: false });
    expect((blocks[2] as unknown as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true });
  });

  it('accepts * and + bullets and CRLF', () => {
    const blocks = parseBlocks('* a\r\n+ b\r\n');
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as unknown as { items: unknown[] }).items).toHaveLength(2);
  });

  it('reads a fenced code block verbatim', () => {
    const blocks = parseBlocks('```\n<script>x</script>\n# not a heading\n```');
    expect(blocks).toEqual([{ type: 'code', text: '<script>x</script>\n# not a heading' }]);
  });

  it('returns nothing for blank text', () => {
    expect(parseBlocks('  \n\n')).toEqual([]);
  });
});

describe('parseBlocks tables and unfinished syntax', () => {
  it('reads a pipe table with a delimiter row', () => {
    const [table] = parseBlocks('| Name | Day |\n| --- | :-: |\n| Ana | Mon |\n| Luis |');
    if (table?.type !== 'table') throw new Error('not a table');
    expect(table.header).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]).toHaveLength(2);
  });

  it('keeps a header with no delimiter row as a paragraph while it streams', () => {
    expect(parseBlocks('| Name | Day |')[0]?.type).toBe('paragraph');
  });

  it('never throws on text cut at any point', () => {
    const full =
      '# T\n\n**bold** and *it* `c` [x](https://a.io/p) [m](https://meetinglive.local/meeting/abc)\n\n```js\ncode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n  - two\n> q';
    for (let end = 0; end <= full.length; end += 1) {
      expect(() => parseBlocks(full.slice(0, end))).not.toThrow();
    }
  });

  it.each(['**unclosed bold', '```\nopen fence', '[label](https://x.io', '[label](', '`tick'])(
    'keeps unfinished %j as text',
    (source) => {
      expect(parseBlocks(source).length).toBeGreaterThan(0);
    },
  );

  it('drops the link of an unsafe scheme and keeps its label', () => {
    expect(parseInline('[go](javascript:alert(1))')).toEqual([{ type: 'text', text: 'go' }]);
    expect(parseInline('[f](file:///c:/x)')).toEqual([{ type: 'text', text: 'f' }]);
  });
});

describe('safeHref meeting citations (T3)', () => {
  const ID = '0123456789abcdef0123456789abcdef';
  it('keeps a meeting citation with or without a valid moment', () => {
    expect(safeHref(`https://meetinglive.local/meeting/${ID}`)).toBe(
      `https://meetinglive.local/meeting/${ID}`,
    );
    expect(safeHref(`https://meetinglive.local/meeting/${ID}?t=725`)).toBe(
      `https://meetinglive.local/meeting/${ID}?t=725`,
    );
  });

  it.each([
    'https://meetinglive.local/meeting/not-a-guid?t=5',
    `https://meetinglive.local/meeting/${ID}?t=-3`,
    `https://meetinglive.local/meeting/${ID}?t=999999`,
    `https://meetinglive.local/meeting/${ID}?t=abc`,
    `https://meetinglive.local/meeting/${ID}?x=1`,
  ])('drops a broken meeting citation %s (its label stays as text)', (href) => {
    expect(safeHref(href)).toBeNull();
    expect(parseInline(`[12:05](${href})`)).toEqual([{ type: 'text', text: '12:05' }]);
  });

  it('other schemes stay rejected', () => {
    expect(safeHref(`meeting://${ID}?t=5`)).toBeNull();
  });
});
