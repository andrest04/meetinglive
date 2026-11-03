import { describe, expect, it } from 'vitest';
import { liveLines, percentFromStatus, overallPercent } from './live-lines';

describe('liveLines', () => {
  it('is empty for blank text', () => {
    expect(liveLines('', '')).toEqual([]);
    expect(liveLines('  \n ', '')).toEqual([]);
  });

  it('reads the stamp, the speaker and the words of a committed line', () => {
    const text = '[00:04.80-00:09.10] [ Speaker-2 ] Thanks. Let us start.';
    expect(liveLines(text, text)).toEqual([
      {
        kind: 'committed',
        start: '00:04.80',
        speaker: 2,
        text: 'Thanks. Let us start.',
        starred: false,
      },
    ]);
  });

  it('marks the header and keeps lines without a stamp as plain text', () => {
    const lines = liveLines('Recorded 2026-11-02 14:05\nhello there', 'Recorded 2026-11-02 14:05');
    expect(lines[0]).toEqual({ kind: 'header', text: 'Recorded 2026-11-02 14:05' });
    expect(lines[1]).toEqual({
      kind: 'interim',
      start: null,
      speaker: null,
      text: 'hello there',
      starred: false,
    });
  });

  it('treats the lines after the committed ones as interim', () => {
    const committed = '[00:00.00-00:02.00] one';
    const display = `${committed}\r\n[00:02.00-00:03.00] two so far`;
    const lines = liveLines(display, committed);
    expect(lines.map((l) => l.kind)).toEqual(['committed', 'interim']);
  });

  it('reads a starred line like the line under the star', () => {
    const line = '* [00:30.00-00:41.55] [ Speaker-1 ] Important.';
    expect(liveLines(line, line)[0]).toMatchObject({
      start: '00:30.00',
      speaker: 1,
      text: 'Important.',
      starred: true,
    });
  });

  it('accepts minutes past 59', () => {
    const line = '[125:03.20-125:05.00] late';
    expect(liveLines(line, line)[0]).toMatchObject({ start: '125:03.20', text: 'late' });
  });
});

describe('percentFromStatus', () => {
  it('reads the number out of the pass status', () => {
    expect(percentFromStatus('Transcribing audio... 42%')).toBe(42);
    expect(percentFromStatus('Transcribing audio...')).toBeNull();
    expect(percentFromStatus('')).toBeNull();
  });
});

describe('overallPercent', () => {
  it('spreads the stages over one bar', () => {
    expect(overallPercent({ stage: 'model', percent: 50, stepIndex: 1, stepCount: 2 })).toBe(75);
    expect(overallPercent({ stage: 'model', percent: 0, stepIndex: 0, stepCount: 3 })).toBe(0);
    expect(overallPercent({ stage: 'model', percent: 100, stepIndex: 2, stepCount: 3 })).toBe(100);
  });
});
