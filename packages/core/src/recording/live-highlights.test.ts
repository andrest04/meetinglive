import { describe, expect, it } from 'vitest';
import { HighlightedLiveText } from './live-highlights';

const text = '[00:00.00-00:02.00] one\n[00:02.00-00:04.00] two';

describe('HighlightedLiveText', () => {
  it('stars the line the mark falls in', () => {
    expect(new HighlightedLiveText().render(text, [3000])).toBe(
      '[00:00.00-00:02.00] one\n* [00:02.00-00:04.00] two',
    );
  });

  it('returns the text itself when there are no marks and does no pass', () => {
    const cache = new HighlightedLiveText();
    expect(cache.render(text, [])).toBe(text);
    expect(cache.passes).toBe(0);
  });

  it('reuses the result until the text or the marks change (B-22)', () => {
    const cache = new HighlightedLiveText();
    cache.render(text, [1000]);
    cache.render(text, [1000]);
    cache.render(text, [1000]);
    expect(cache.passes).toBe(1);
    cache.render(`${text}\n[00:04.00-00:05.00] three`, [1000]);
    expect(cache.passes).toBe(2);
    cache.render(`${text}\n[00:04.00-00:05.00] three`, [1000, 4500]);
    expect(cache.passes).toBe(3);
  });
});
