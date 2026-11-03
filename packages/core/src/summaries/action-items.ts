import type { ActionItem } from '../library/meeting';

/**
 * Checkbox line: `-`, `*` or `+` bullet, flexible spacing, a box holding a space or x/X,
 * and text after the box (B26). Numbered lists never match.
 */
const ACTION_ITEM = /^\s*[-*+]\s*\[([ xX])\]\s*(\S.*)$/;

/** True when the line is a checkbox item line (used by the splitter fallback). */
export function isCheckboxLine(line: string): boolean {
  return ACTION_ITEM.test(line);
}

/** Parses checkbox lines from a section body. Other lines are ignored. */
export function parseActionItems(sectionBody: string | null | undefined): ActionItem[] {
  if (sectionBody === null || sectionBody === undefined || sectionBody.trim() === '') return [];
  const items: ActionItem[] = [];
  for (const line of sectionBody.replace(/\r\n/g, '\n').split('\n')) {
    const match = ACTION_ITEM.exec(line);
    if (match) items.push({ text: (match[2] ?? '').trim(), isDone: match[1] !== ' ' });
  }
  return items;
}

/** Renders `- [x] text` or `- [ ] text` per item, one newline each. Empty list gives ''. */
export function renderActionItems(items: readonly ActionItem[]): string {
  return items.map((item) => `- [${item.isDone ? 'x' : ' '}] ${item.text}\n`).join('');
}
