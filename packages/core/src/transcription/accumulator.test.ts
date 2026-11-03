import { describe, expect, it } from 'vitest';
import type { AsrResult, AsrWord } from './asr-types';
import { StreamingTranscriptAccumulator } from './accumulator';
import { formatHeader, formatLine } from './stamp-format';

const RECORDED_AT = Date.UTC(2026, 8, 2, 15, 0, 0);
const header = formatHeader(RECORDED_AT);
const NL = '\n';
const s = (seconds: number): number => Math.round(seconds * 1000);

const word = (start: number, end: number, speakerTag = 0, text: string | null = null): AsrWord => ({
  startMs: s(start),
  endMs: s(end),
  speakerTag,
  text,
});
const result = (
  isFinal: boolean,
  transcript: string,
  audioProcessedSeconds: number,
  words: AsrWord[] = [],
): AsrResult => ({ isFinal, transcript, audioProcessedSeconds, words });
const interim = (text: string): AsrResult => result(false, text, 0);
const final = (text: string, start: number, end: number): AsrResult =>
  result(true, text, end, [word(start, end)]);
const line = (start: number, end: number, text: string, tag = 0): string =>
  formatLine(s(start), s(end), text, tag);
const make = (recordedAt: number | null = RECORDED_AT): StreamingTranscriptAccumulator =>
  new StreamingTranscriptAccumulator(recordedAt);

describe('StreamingTranscriptAccumulator', () => {
  it('Apply_Interim_ReplacesPartialSuffix', () => {
    const acc = make();
    acc.apply(interim('hel'));
    acc.apply(interim('hello'));
    expect(acc.displayText).toBe(header + NL + 'hello');
    expect(acc.committedText).toBe('');
  });

  it('Apply_Final_CommitsTimestampedLine', () => {
    const acc = make();
    acc.apply(result(true, 'Hello there', 2, [word(1, 1.4), word(1.4, 2)]));
    expect(acc.committedText).toBe(header + NL + line(1, 2, 'Hello there'));
    expect(acc.displayText).toBe(acc.committedText);
  });

  it('Apply_ShortFinal_StaysOneLine', () => {
    const acc = make();
    const words = [0, 1, 2, 3, 4].map((i) => word(i * 4, (i + 1) * 4));
    acc.apply(result(true, 'short window stays together', 20, words));
    expect(acc.committedText).toBe(header + NL + line(0, 20, 'short window stays together'));
    expect(acc.committedText).not.toContain('->');
  });

  it('Apply_MixedSequence_CommitsFinalsAndReplacesInterim', () => {
    const acc = make();
    acc.apply(interim('hel'));
    acc.apply(final('Hello', 0, 1));
    acc.apply(interim('wor'));
    acc.apply(interim('world'));
    acc.apply(final('world', 1, 2));
    const expected = [header, line(0, 1, 'Hello'), line(1, 2, 'world')].join(NL);
    expect(acc.displayText).toBe(expected);
    expect(acc.committedText).toBe(expected);
  });

  it('DisplayText_AfterFinal_ShowsCommittedPlusCurrentInterim', () => {
    const acc = make();
    acc.apply(final('Hello', 0, 1));
    acc.apply(interim('wor'));
    expect(acc.displayText).toBe([header, line(0, 1, 'Hello'), 'wor'].join(NL));
    expect(acc.committedText).toBe([header, line(0, 1, 'Hello')].join(NL));
  });

  it('Apply_FinalWithoutWords_UsesAudioProcessed', () => {
    const acc = make();
    acc.apply(result(true, 'Hi', 3.2, []));
    expect(acc.committedText).toBe(header + NL + line(0, 3.2, 'Hi'));
  });

  it('has no clock skew: stamps are elapsed time only (B1)', () => {
    const acc = make();
    acc.apply(final('after break', 300, 330));
    expect(acc.committedText).toBe(header + NL + line(300, 330, 'after break'));
    expect(acc.committedText).not.toContain('|');
    expect('clockSkew' in acc).toBe(false);
  });

  it('Apply_WhenRecordedAtIsUnknown_OmitsClockAndHeader', () => {
    const acc = make(null);
    acc.apply(final('Hello', 0, 1));
    expect(acc.committedText).toBe('[00:00.00-00:01.00] Hello');
  });

  it('Apply_LongFinal_SplitsIntoThirtySecondWindows', () => {
    const acc = make();
    const tokens = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const words = tokens.map((_, i) => word(i * 10, (i + 1) * 10));
    acc.apply(result(true, tokens.join(' '), 90, words));
    expect(acc.committedText).toBe(
      [
        header,
        line(0, 20, 'one two'),
        line(20, 40, 'three four'),
        line(40, 60, 'five six'),
        line(60, 80, 'seven eight'),
        line(80, 90, 'nine'),
      ].join(NL),
    );
  });

  it('Apply_LongFinal_ExtraTokens_AppendToLastWindow', () => {
    const acc = make();
    const words = [word(0, 10), word(10, 20), word(20, 30), word(30, 40)];
    acc.apply(result(true, 'a b c d extra leftover', 40, words));
    expect(acc.committedText).toBe(
      [header, line(0, 20, 'a b'), line(20, 40, 'c d extra leftover')].join(NL),
    );
  });

  it('Apply_LongFinal_SingleToken_DoesNotSplitMidWord', () => {
    const acc = make();
    acc.apply(result(true, 'supercalifragilistic', 90, [word(0, 90)]));
    expect(acc.committedText).toBe(header + NL + line(0, 90, 'supercalifragilistic'));
  });

  it('Apply_SameSpeakerWithPause_SplitsIntoIdeaLines', () => {
    const acc = make();
    const words = [word(0, 1, 1), word(1, 1.2, 1), word(2.5, 3.5, 1)];
    acc.apply(result(true, 'hello there later', 3.5, words));
    expect(acc.committedText).toBe(
      [header, line(0, 1.2, 'hello there', 1), line(2.5, 3.5, 'later', 1)].join(NL),
    );
  });

  it('Apply_SameSpeakerWithShortGap_StaysOneLine', () => {
    const acc = make();
    acc.apply(result(true, 'hello there', 0.9, [word(0, 0.4, 1), word(0.5, 0.9, 1)]));
    expect(acc.committedText).toBe(header + NL + line(0, 0.9, 'hello there', 1));
  });

  it('Apply_SpeakerChange_SplitsLinesAndPreservesStamps', () => {
    const acc = make();
    const words = [word(0, 1, 1), word(1, 2, 1), word(2, 3, 2), word(3, 4, 2), word(4, 5, 2)];
    acc.apply(result(true, 'hello there how are you', 5, words));
    expect(acc.committedText).toBe(
      [header, line(0, 2, 'hello there', 1), line(2, 5, 'how are you', 2)].join(NL),
    );
  });

  it('Apply_InterimWithWords_FormatsTimestampedDisplayWithoutCommitting', () => {
    const acc = make();
    acc.apply(result(false, 'hello there', 2, [word(0, 1, 1), word(1, 2, 2)]));
    expect(acc.displayText).toBe([header, line(0, 1, 'hello', 1), line(1, 2, 'there', 2)].join(NL));
    expect(acc.committedText).toBe('');
  });

  it('Apply_InterimWithWords_DoesNotAdvanceLastEndForNextFinal', () => {
    const acc = make();
    acc.apply(result(false, 'draft window', 40, [word(0, 40)]));
    acc.apply(result(true, 'Hi', 3.2, []));
    expect(acc.committedText).toBe(header + NL + line(0, 3.2, 'Hi'));
  });

  it('CommitRemainingInterim_FormatsLeftoverWordsIntoCommittedLines', () => {
    const acc = make();
    acc.apply(result(false, 'hello there', 2, [word(0, 2, 0)]));
    acc.commitRemainingInterim();
    const expected = header + NL + line(0, 2, 'hello there');
    expect(acc.committedText).toBe(expected);
    expect(acc.displayText).toBe(expected);
  });

  it('Apply_UntaggedWords_KeepsOldFormatWithoutSpeakerPrefix', () => {
    const acc = make();
    acc.apply(result(true, 'hello there', 2, [word(0, 1, 0), word(1, 2, 0)]));
    expect(acc.committedText).toBe(header + NL + line(0, 2, 'hello there'));
    expect(acc.committedText).not.toContain('Speaker-');
  });

  it('Apply_SpeakerChange_WhenWordTextsMatchCount_UsesWordTexts', () => {
    const acc = make();
    const words = [word(0, 1, 1, 'Hello,'), word(1, 2, 2, 'world.')];
    acc.apply(result(true, 'Hello world', 2, words));
    expect(acc.committedText).toBe(
      [header, line(0, 1, 'Hello,', 1), line(1, 2, 'world.', 2)].join(NL),
    );
  });

  describe('results with no word timings', () => {
    const tokens = Array.from({ length: 150 }, (_, i) => `w${String(i + 1)}`);

    function assertWindows(lines: string[]): void {
      expect(lines.length).toBeGreaterThanOrEqual(3);
      const seen: string[] = [];
      let cursor = 0;
      for (const text of lines) {
        const m = /^\[(\d+):(\d+\.\d+)-(\d+):(\d+\.\d+)\] (.+)$/.exec(text);
        expect(m, text).not.toBeNull();
        const from = Number(m?.[1]) * 60 + Number(m?.[2]);
        const to = Number(m?.[3]) * 60 + Number(m?.[4]);
        expect(to - from).toBeLessThanOrEqual(30.01);
        expect(from).toBeGreaterThanOrEqual(cursor - 0.01);
        cursor = to;
        seen.push(...(m?.[5] ?? '').split(' '));
      }
      expect(seen).toEqual(tokens);
      expect(cursor).toBeCloseTo(75, 1);
    }

    it('Apply_NoWordsInterimSpanning75Seconds_SplitsIntoWindowsOfAtMost30Seconds', () => {
      const acc = make();
      acc.apply(result(false, tokens.join(' '), 75, []));
      assertWindows(acc.displayText.split(NL).slice(1));
    });

    it('Apply_NoWordsFinalSpanning75Seconds_SplitsIntoWindowsOfAtMost30Seconds', () => {
      const acc = make();
      acc.apply(result(true, tokens.join(' '), 75, []));
      assertWindows(acc.committedText.split(NL).slice(1));
      acc.apply(result(true, 'next', 80, []));
      expect(acc.committedText.endsWith(line(75, 80, 'next'))).toBe(true);
    });

    it('Apply_NoWordsFinalWithin30Seconds_StaysOneLine', () => {
      const acc = make();
      acc.apply(result(true, 'short text here', 20, []));
      expect(acc.committedText).toBe(header + NL + line(0, 20, 'short text here'));
    });
  });

  it('a final, even an empty one, clears the interim', () => {
    const acc = make();
    acc.apply(interim('partial'));
    acc.apply(result(true, '   ', 1, []));
    expect(acc.displayText).toBe('');
  });

  it('joins lines with the newline it was given', () => {
    const acc = new StreamingTranscriptAccumulator(RECORDED_AT, { newline: '\r\n' });
    acc.apply(final('a', 0, 1));
    acc.apply(final('b', 1, 2));
    expect(acc.committedText.split('\r\n')).toHaveLength(3);
  });

  describe('B10: text without spaces (Japanese, Chinese)', () => {
    it('still splits at speaker changes using the engine word texts', () => {
      const acc = make();
      const words = [word(0, 1, 1, 'こん'), word(1, 2, 1, 'にちは'), word(2, 3, 2, '世界')];
      acc.apply(result(true, 'こんにちは世界', 3, words));
      expect(acc.committedText).toBe(
        [header, line(0, 2, 'こんにちは', 1), line(2, 3, '世界', 2)].join(NL),
      );
    });
  });

  describe('B18: committing a bare interim', () => {
    it('stamps a bare interim line instead of leaving it unstamped', () => {
      const acc = make();
      acc.apply(final('first', 0, 2));
      acc.apply(result(false, 'half a thought', 2, []));
      expect(acc.displayText.split(NL).at(-1)).toBe('half a thought');
      acc.commitRemainingInterim();
      expect(acc.committedText.split(NL).at(-1)).toBe(line(2, 2, 'half a thought'));
    });
  });
});
