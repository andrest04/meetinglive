import type { ActionItem } from '../library/meeting';
import { isCheckboxLine, parseActionItems } from './action-items';

export interface SplitSummary {
  readonly summaryMarkdown: string;
  readonly actionItems: ActionItem[];
  readonly suggestedTitle: string | null;
}

const key = (line: string): string => line.trim().toLowerCase();
const isTitleHeader = (line: string): boolean => key(line) === '## title';
const isActionHeader = (line: string): boolean =>
  key(line) === '## action items' || key(line) === '**action items**';
const isTitleEnd = (line: string): boolean => line.trim().startsWith('## ') || isActionHeader(line);

/** Drops a wrapping ``` or ```markdown fence around the whole reply (B25). */
function stripCodeFence(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start++;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--;
  if (end - start < 2) return lines;
  const first = (lines[start] ?? '').trim().toLowerCase();
  const last = (lines[end - 1] ?? '').trim();
  if ((first === '```' || first === '```markdown' || first === '```md') && last === '```') {
    return lines.slice(start + 1, end - 1);
  }
  return lines;
}

/** Splits a model reply into summary, action items and raw (not normalized) title. */
export function splitSummaryResponse(raw: string): SplitSummary {
  const lines = stripCodeFence(raw.replace(/\r\n/g, '\n').split('\n'));

  let suggestedTitle: string | null = null;
  const titleIndex = lines.findIndex(isTitleHeader);
  let titleEnd = -1;
  if (titleIndex >= 0) {
    titleEnd = lines.length;
    const parts: string[] = [];
    for (let i = titleIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (isTitleEnd(line)) {
        titleEnd = i;
        break;
      }
      if (line.trim() !== '') parts.push(line.trim());
    }
    suggestedTitle = parts.length > 0 ? parts.join(' ') : null;
  }

  let splitIndex = lines.findIndex(isActionHeader);
  if (splitIndex < 0) splitIndex = lines.findIndex(isCheckboxLine);

  let summaryLines: string[];
  let actionItems: ActionItem[] = [];
  if (splitIndex < 0) {
    summaryLines = lines.slice();
  } else {
    summaryLines = lines.slice(0, splitIndex);
    actionItems = parseActionItems(lines.slice(splitIndex).join('\n'));
  }

  if (titleIndex >= 0) {
    summaryLines = summaryLines.filter((_, i) => i < titleIndex || i >= titleEnd);
  }

  let summary = summaryLines.join('\n').trim();
  if (summary.slice(0, 10).toLowerCase() === '## summary') {
    summary = summary.slice(10).trim();
  }
  return { summaryMarkdown: summary, actionItems, suggestedTitle };
}
