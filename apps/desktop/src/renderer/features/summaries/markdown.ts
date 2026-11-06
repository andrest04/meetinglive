/**
 * A small Markdown reader for model replies: headings, paragraphs, lists, quotes, code, bold,
 * italic, inline code and links. It produces plain data; `MarkdownView` turns that into React
 * elements, so no string of the reply ever reaches the DOM as HTML. Raw HTML is just text.
 */
import { hasMeetingPrefix, tryParseMeetingCitation } from '@vozella/core';

export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'strong'; readonly children: readonly Inline[] }
  | { readonly type: 'em'; readonly children: readonly Inline[] }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] };

export interface ListItem {
  readonly children: readonly Inline[];
  readonly nested: readonly Block[];
}

export type Block =
  | {
      readonly type: 'heading';
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly children: readonly Inline[];
    }
  | { readonly type: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly ListItem[] }
  | { readonly type: 'quote'; readonly children: readonly Block[] }
  | { readonly type: 'code'; readonly text: string }
  | {
      readonly type: 'table';
      readonly header: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly type: 'rule' };

/** `href` with percent escapes undone; the URL reader escapes a braced id as %7B...%7D. */
export function decodedHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/**
 * The normalized address when it is http or https; null for any other scheme or a non-URL. A
 * meeting citation must also be valid (id, optional `?t=` from 0 to one day): a broken one is
 * dropped, so its label stays as text instead of a link that does nothing.
 */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const href = decodedHref(url.href);
    if (hasMeetingPrefix(href) && tryParseMeetingCitation(href) === null) return null;
    return url.href;
  } catch {
    return null;
  }
}

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);
const isSpace = (char: string | undefined): boolean => char === undefined || /\s/.test(char);

/** Index of `marker` at or after `from` that is not escaped, or -1. */
function findClose(text: string, marker: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
    } else if (text.startsWith(marker, i)) {
      return i;
    }
  }
  return -1;
}

/** The `)` that closes a link address, allowing balanced parentheses inside it. */
function findUrlEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = (): void => {
    if (buffer !== '') out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < source.length) {
    const char = source[i] ?? '';
    if (char === '\\' && i + 1 < source.length) {
      buffer += source.charAt(i + 1);
      i += 2;
      continue;
    }
    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (source.startsWith('**', i) && !isSpace(source[i + 2])) {
      const end = findClose(source, '**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((char === '*' || char === '_') && !isSpace(source[i + 1])) {
      const openOk = char === '*' || !isWordChar(source[i - 1]);
      const end = openOk ? findClose(source, char, i + 1) : -1;
      const closeOk = end > i + 1 && (char === '*' || !isWordChar(source[end + 1]));
      if (closeOk && !isSpace(source[end - 1])) {
        flush();
        out.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (char === '[') {
      const labelEnd = findClose(source, ']', i + 1);
      if (labelEnd > i && source[labelEnd + 1] === '(') {
        const urlEnd = findUrlEnd(source, labelEnd + 2);
        if (urlEnd > labelEnd) {
          flush();
          const children = parseInline(source.slice(i + 1, labelEnd));
          const href = safeHref(source.slice(labelEnd + 2, urlEnd));
          if (href === null) out.push(...children);
          else out.push({ type: 'link', href, children });
          i = urlEnd + 1;
          continue;
        }
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^ {0,3}```/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Cells of a pipe row, without the outer pipes. An escaped pipe stays inside its cell. */
function splitRow(line: string): string[] {
  const trimmed = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/** A header row followed by a delimiter row with the same number of cells. */
const startsTable = (lines: readonly string[], at: number): boolean => {
  const head = lines[at] ?? '';
  const delimiter = lines[at + 1];
  return (
    head.includes('|') &&
    delimiter !== undefined &&
    delimiter.includes('-') &&
    TABLE_DELIMITER.test(delimiter) &&
    splitRow(delimiter).length === splitRow(head).length
  );
};

const startsBlock = (line: string): boolean =>
  HEADING.test(line) ||
  RULE.test(line) ||
  LIST_ITEM.test(line) ||
  FENCE.test(line) ||
  QUOTE.test(line);

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    if (startsTable(lines, i)) {
      const header = splitRow(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? '').trim() !== '' && (lines[i] ?? '').includes('|')) {
        const cells = splitRow(lines[i] ?? '');
        rows.push(header.map((_, column) => parseInline(cells[column] ?? '')));
        i += 1;
      }
      blocks.push({ type: 'table', header: header.map((cell) => parseInline(cell)), rows });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: (heading[1] ?? '').length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2] ?? ''),
      });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        body.push(QUOTE.exec(lines[i] ?? '')?.[1] ?? '');
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseBlocks(body.join('\n')) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const taken = takeList(lines, i);
      blocks.push(...taken.blocks);
      i = taken.next;
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      (body.length === 0 || !startsBlock(lines[i] ?? ''))
    ) {
      body.push((lines[i] ?? '').trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(body.join(' ')) });
  }
  return blocks;
}

/** Consecutive items at one indent are one list; deeper lines belong to the item above. */
function takeList(lines: readonly string[], start: number): { blocks: Block[]; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  const baseIndent = (first?.[1] ?? '').length;
  const blocks: Block[] = [];
  let ordered = /\d/.test(first?.[2] ?? '');
  let items: { text: string; nested: string[] }[] = [];
  const close = (): void => {
    if (items.length === 0) return;
    blocks.push({
      type: 'list',
      ordered,
      items: items.map((item) => ({
        children: parseInline(item.text),
        nested: item.nested.length > 0 ? parseBlocks(item.nested.join('\n')) : [],
      })),
    });
    items = [];
  };
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      // A blank line only continues the list when the next line is another item of it.
      const following = lines[i + 1];
      const match = following === undefined ? null : LIST_ITEM.exec(following);
      if (match && (match[1] ?? '').length >= baseIndent) {
        i += 1;
        continue;
      }
      break;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const indent = (item[1] ?? '').length;
      if (indent < baseIndent) break;
      if (indent > baseIndent && items.length > 0) {
        (items[items.length - 1] as { nested: string[] }).nested.push(line.slice(baseIndent));
        i += 1;
        continue;
      }
      const isOrdered = /\d/.test(item[2] ?? '');
      if (isOrdered !== ordered && items.length > 0) {
        close();
        ordered = isOrdered;
      }
      items.push({ text: item[3] ?? '', nested: [] });
      i += 1;
      continue;
    }
    if (/^\s+\S/.test(line) && items.length > 0) {
      const last = items[items.length - 1] as { text: string; nested: string[] };
      if (last.nested.length > 0) last.nested.push(line.slice(baseIndent));
      else last.text += ` ${line.trim()}`;
      i += 1;
      continue;
    }
    break;
  }
  close();
  return { blocks, next: i };
}
