import type { InstallProgressDto } from '@vozella/contracts';

export interface HeaderLine {
  readonly kind: 'header';
  readonly text: string;
}

export interface TextLine {
  /** `committed` lines are final; `interim` ones may still be rewritten by the engine. */
  readonly kind: 'committed' | 'interim';
  /** The start of the stamp (`mm:ss.ff`), or null for a bare line. */
  readonly start: string | null;
  readonly speaker: number | null;
  readonly text: string;
  readonly starred: boolean;
}

export type LiveLine = HeaderLine | TextLine;

const STAMPED = /^(\* )?\[(\d+:\d{2}\.\d{2})-\d+:\d{2}\.\d{2}\](?: \[ Speaker-(\d+) \])? ?(.*)$/;
const HEADER = /^(Recorded|Ended) /;

export const splitLines = (text: string): string[] =>
  text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '');

/**
 * Turns the live transcript into lines the page can draw. `committedText` is the part that will not
 * change: the display text starts with it, and what follows is the interim suffix.
 */
export function liveLines(displayText: string, committedText: string): LiveLine[] {
  return liveLinesFrom(displayText, splitLines(committedText).length);
}

/** The same, when the caller already knows how many lines are committed (Infinity: all). */
export function liveLinesFrom(displayText: string, committedCount: number): LiveLine[] {
  return splitLines(displayText).map((line, index): LiveLine => {
    if (HEADER.test(line.trimStart())) return { kind: 'header', text: line.trim() };
    const kind = index < committedCount ? 'committed' : 'interim';
    const match = STAMPED.exec(line);
    if (!match) return { kind, start: null, speaker: null, text: line.trim(), starred: false };
    return {
      kind,
      start: match[2] ?? null,
      speaker: match[3] === undefined ? null : Number(match[3]),
      text: (match[4] ?? '').trim(),
      starred: match[1] !== undefined,
    };
  });
}

/** The percent in "Transcribing audio... 42%", or null while the pass has not reported one. */
export function percentFromStatus(status: string): number | null {
  const match = /(\d{1,3})%/.exec(status);
  return match?.[1] === undefined ? null : Math.min(100, Number(match[1]));
}

/** One bar for the whole install: each stage owns an equal share. */
export function overallPercent(progress: InstallProgressDto): number {
  const share = 100 / progress.stepCount;
  return Math.round(Math.min(100, progress.stepIndex * share + (progress.percent / 100) * share));
}
