import { describe, expect, it } from 'vitest';
import {
  extractCommittedBody,
  isTranscriptHeader,
  parseCommittedLineEnd,
  splitCommittedLines,
} from './committed-line';
import { applyHighlights, formatMarkLine, starredLineStarts } from './highlights';
import {
  buildTaggedDocument,
  lineId,
  parseTranscriptLines,
  truncateToCompleteLines,
} from './line-index';
import { distinctPercent, toPercent } from './progress';
import {
  ensureEndedHeader,
  formatElapsed,
  formatEnded,
  formatHeader,
  formatLine,
} from './stamp-format';

const at = Date.UTC(2026, 10, 2, 14, 5);
const localStamp = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe('stamp formatter', () => {
  it('FormatHeader_UsesLocalRecordedStamp', () => {
    expect(formatHeader(at)).toBe(`Recorded ${localStamp(at)}`);
  });
  it('FormatEnded_UsesLocalEndedStamp', () => {
    expect(formatEnded(at)).toBe(`Ended ${localStamp(at)}`);
  });
  it('FormatLine_WhenSpeakerTagIsZero_OmitsSpeakerBracket', () => {
    expect(formatLine(1000, 4320, 'Hi')).toBe('[00:01.00-00:04.32] Hi');
  });
  it('FormatLine_WhenSpeakerTagIsPositive_IncludesSpeakerBracket', () => {
    expect(formatLine(0, 1000, 'Hi', 2)).toBe('[00:00.00-00:01.00] [ Speaker-2 ] Hi');
  });
  it('FormatLine_NegativeElapsed_ClampsToZero', () => {
    expect(formatLine(-5000, -1000, 'x')).toBe('[00:00.00-00:00.00] x');
  });
  it('FormatLine_WhenEndIsBeforeStart_UsesStartForEnd', () => {
    expect(formatLine(5000, 2000, 'x')).toBe('[00:05.00-00:05.00] x');
  });
  it('FormatLine_WhenMinutesExceed59_KeepsTotalMinutes', () => {
    expect(formatElapsed(125 * 60_000 + 3200)).toBe('125:03.20');
  });
  it('truncates hundredths', () => {
    expect(formatElapsed(1999)).toBe('00:01.99');
    expect(formatElapsed(1009)).toBe('00:01.00');
  });

  describe('EnsureEndedHeader', () => {
    const rec = Date.UTC(2026, 10, 2, 14, 0);
    const end = Date.UTC(2026, 10, 2, 14, 52);
    const recorded = formatHeader(rec);
    const ended = formatEnded(end);
    it('WhenRecordedHeaderExists_InsertsEndedAsSecondLine', () => {
      const out = ensureEndedHeader(`${recorded}\n[00:00.00-00:01.00] a`, rec, end);
      expect(out).toBe(`${recorded}\n${ended}\n[00:00.00-00:01.00] a`);
    });
    it('WhenEndedHeaderExists_ReplacesSecondLine', () => {
      const out = ensureEndedHeader(`${recorded}\nEnded 1999-01-01 00:00\nbody`, rec, end);
      expect(out).toBe(`${recorded}\n${ended}\nbody`);
    });
    it('WhenCalledTwice_DoesNotDuplicateEnded', () => {
      const once = ensureEndedHeader('[00:00.00-00:01.00] a', rec, end);
      expect(ensureEndedHeader(once, rec, end)).toBe(once);
    });
    it('WhenTimestampsAreUnknown_ReturnsTranscriptUnchanged', () => {
      expect(ensureEndedHeader('text', null, end)).toBe('text');
      expect(ensureEndedHeader('text', rec, null)).toBe('text');
      expect(ensureEndedHeader('', rec, end)).toBe('');
    });
    it('WhenRecordedHeaderIsMissing_PrependsRecordedAndEnded', () => {
      expect(ensureEndedHeader('body', rec, end)).toBe(`${recorded}\n${ended}\nbody`);
    });
    it('keeps CRLF', () => {
      const out = ensureEndedHeader(`${recorded}\r\nbody`, rec, end);
      expect(out).toBe(`${recorded}\r\n${ended}\r\nbody`);
    });
    it('B20: a transcript that starts with Ended gets one Recorded line, not two pairs', () => {
      const out = ensureEndedHeader('Ended 1999-01-01 00:00\nbody', rec, end);
      expect(out).toBe(`${recorded}\n${ended}\nbody`);
    });
  });
});

describe('highlights', () => {
  const t =
    'Recorded x\n[00:00.00-00:10.00] one\n[00:12.00-00:20.00] two\n[00:30.00-00:41.55] three';
  it('Apply_WhenNoHighlights_ReturnsTranscriptUnchanged', () => {
    expect(applyHighlights(t, [])).toBe(t);
    expect(applyHighlights(null, [])).toBe('');
  });
  it('Apply_WhenTranscriptEmpty_WritesMarkLines', () => {
    expect(applyHighlights('', [5000, 1500])).toBe('* 00:01.50\n* 00:05.00');
    expect(formatMarkLine(61_000)).toBe('* 01:01.00');
  });
  it('Apply_WhenMarkFallsInsideLine_PrefixesThatLine', () => {
    expect(applyHighlights(t, [15_000]).split('\n')[2]).toBe('* [00:12.00-00:20.00] two');
  });
  it('Apply_WhenLineAlreadyMarked_DoesNotDoublePrefix', () => {
    const once = applyHighlights(t, [15_000]);
    expect(applyHighlights(once, [15_000])).toBe(once);
  });
  it('Apply_WhenMarkIsBetweenLines_StarsThePreviousLine', () => {
    expect(applyHighlights(t, [11_000]).split('\n')[1]).toBe('* [00:00.00-00:10.00] one');
  });
  it('Apply_WhenTwoMarksHitTheSameLine_StarsOnce', () => {
    const out = applyHighlights(t, [13_000, 14_000, 13_000]);
    expect(out.split('\n')[2]).toBe('* [00:12.00-00:20.00] two');
  });
  it('stars the first stamped line for a mark before it, appends marks when nothing is stamped', () => {
    expect(applyHighlights('[00:05.00-00:06.00] a', [0])).toBe('* [00:05.00-00:06.00] a');
    expect(applyHighlights('plain', [2000])).toBe('plain\n* 00:02.00');
  });
  it('keeps CRLF and survives huge minute counts (B19)', () => {
    const out = applyHighlights('[99999999999:00.00-99999999999:05.00] a\r\nb', [1]);
    expect(out.startsWith('* [')).toBe(true);
    expect(out).toContain('\r\n');
  });
  it('reads starred lines back for re-applying (B8)', () => {
    const starred = applyHighlights(t, [15_000, 31_000]);
    expect(starredLineStarts(starred)).toEqual([12_000, 30_000]);
  });
});

describe('line index', () => {
  it('Parse_NonEmptyLines_AssignsSequentialL000Ids', () => {
    const lines = parseTranscriptLines('a\nb');
    expect(lines.map((l) => l.id)).toEqual(['L000', 'L001']);
  });
  it('Parse_SkipsBlankLinesAndTrims_SplitsCrLf', () => {
    const lines = parseTranscriptLines(' a \r\n\r\n  b\n');
    expect(lines.map((l) => l.text)).toEqual(['a', 'b']);
    expect(lines.map((l) => l.index)).toEqual([0, 1]);
  });
  it('Parse_WhenEmptyOrWhitespace_ReturnsNoLines', () => {
    expect(parseTranscriptLines('  \n ')).toEqual([]);
    expect(parseTranscriptLines(null)).toEqual([]);
  });
  it('BuildTaggedDocument_PrefixesIdsWithPipe', () => {
    expect(buildTaggedDocument(parseTranscriptLines('a\nb'))).toBe('L000| a\nL001| b');
    expect(lineId(1000)).toBe('L1000');
  });
  it('TruncateToCompleteLines keeps whole lines and at least the first', () => {
    const lines = parseTranscriptLines('aaaa\nbbbb\ncccc');
    expect(truncateToCompleteLines(lines, 0)).toEqual([]);
    expect(truncateToCompleteLines(lines, 1000)).toHaveLength(3);
    expect(truncateToCompleteLines(lines, 'L000| aaaa\nL001| bbbb'.length)).toHaveLength(2);
    expect(truncateToCompleteLines(lines, 3)).toHaveLength(1);
    expect(truncateToCompleteLines([], 10)).toEqual([]);
  });
});

describe('committed line parser', () => {
  it('splits on CRLF, LF and CR', () => {
    expect(splitCommittedLines('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitCommittedLines(null)).toEqual([]);
  });
  it('detects headers', () => {
    expect(isTranscriptHeader('  Recorded 2026-01-01 10:00')).toBe(true);
    expect(isTranscriptHeader('Ended 2026-01-01 10:00')).toBe(true);
    expect(isTranscriptHeader('Recorded')).toBe(false);
  });
  it('reads the end of a well formed stamp only', () => {
    expect(parseCommittedLineEnd('[00:01.00-00:04.32] hi')).toBe(4320);
    expect(parseCommittedLineEnd('[125:03.20-125:04.00] hi')).toBe(125 * 60_000 + 4000);
    expect(parseCommittedLineEnd('[0:01.00-00:04.32] hi')).toBeNull();
    expect(parseCommittedLineEnd('[00:60.00-00:61.00] hi')).toBeNull();
    expect(parseCommittedLineEnd('[00:01.0-00:04.32] hi')).toBeNull();
    expect(parseCommittedLineEnd('no stamp')).toBeNull();
    expect(parseCommittedLineEnd('[]')).toBeNull();
  });
  it('extracts the body without stamp and speaker label', () => {
    expect(extractCommittedBody('[00:03.00-00:05.50] [ Speaker-2 ] Hello there')).toBe(
      'Hello there',
    );
    expect(extractCommittedBody('[00:03.00-00:05.50] Hello')).toBe('Hello');
    expect(extractCommittedBody('  plain ')).toBe('plain');
    expect(extractCommittedBody('')).toBe('');
    expect(extractCommittedBody('[00:60.00-00:61.00] bad')).toBe('[00:60.00-00:61.00] bad');
    expect(extractCommittedBody('[00:03.00-00:05.50] [ Speaker-x ] t')).toBe('[ Speaker-x ] t');
  });
  it('B14: a starred line reads like the line under the star', () => {
    expect(extractCommittedBody('* [00:30.00-00:41.55] [ Speaker-1 ] Starred')).toBe('Starred');
    expect(parseCommittedLineEnd('* [00:30.00-00:41.55] x')).toBe(41_550);
  });
});

describe('progress', () => {
  it('ToPercent_ClampsTo0Through100', () => {
    expect(toPercent(0, 0)).toBe(0);
    expect(toPercent(50, 100)).toBe(50);
    expect(toPercent(1, 200)).toBe(1);
    expect(toPercent(200, 100)).toBe(100);
    expect(toPercent(-5, 100)).toBe(0);
  });
  it('B13: reports each distinct percent once', () => {
    const seen: number[] = [];
    const report = distinctPercent((p) => seen.push(p));
    for (let i = 0; i < 1000; i += 1) report(toPercent(i, 1000) < 50 ? 10 : 20);
    expect(seen).toEqual([10, 20]);
  });
});
