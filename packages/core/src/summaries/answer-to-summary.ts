import type { ActionItem } from '../library/meeting';
import { isCheckboxLine } from './action-items';
import { splitSummaryResponse } from './summary-splitter';

/** What a meeting's summary is made of: the text and its action items. */
export interface SummaryContent {
  readonly summary: string | null;
  readonly actionItems: readonly ActionItem[];
}

const key = (line: string): string => line.trim().toLowerCase();
const isSummaryHeader = (line: string): boolean => key(line) === '## summary';
const isActionHeader = (line: string): boolean =>
  key(line) === '## action items' || key(line) === '**action items**';

/**
 * Turns a chat answer into the summary content it replaces (T4).
 *
 * An answer shaped like a generated summary (`## Summary` and/or `## Action Items`) goes through
 * the same splitter as a summary run. Its action items replace the stored ones only when the
 * answer has an action section or checkbox lines; an answer with action items and no summary text
 * keeps the stored summary. Any other answer becomes the summary text as it is, and the stored
 * action items stay. Returns null when nothing would change. Reserved `##` headers inside the text
 * are escaped by the meeting file writer, as for every summary.
 */
export function summaryFromAnswer(
  answer: string,
  existing: SummaryContent,
): { readonly summary: string; readonly actionItems: ActionItem[] } | null {
  const text = answer.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const kept = (): ActionItem[] => existing.actionItems.map((item) => ({ ...item }));
  if (!lines.some((line) => isSummaryHeader(line) || isActionHeader(line))) {
    const summary = text.trim();
    return summary === '' ? null : { summary, actionItems: kept() };
  }
  const split = splitSummaryResponse(text);
  const hasActions = lines.some((line) => isActionHeader(line) || isCheckboxLine(line));
  const actionItems = hasActions ? split.actionItems : kept();
  const summary = split.summaryMarkdown.trim();
  if (summary !== '') return { summary, actionItems };
  const stored = (existing.summary ?? '').trim();
  if (!hasActions || stored === '') return null;
  return { summary: existing.summary ?? '', actionItems };
}
