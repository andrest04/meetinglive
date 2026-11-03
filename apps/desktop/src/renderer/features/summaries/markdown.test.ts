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
