import { describe, expect, it } from 'vitest';
import { looksLikePlaceholder, placeholderPatternsFromFormats } from '../summaries/suggested-title';
import { defaultMeetingTitle, placeholderFormats } from './default-title';

const en = { MeetingTitleFormat: 'Meeting {0}', MeetingTitleDateFormat: 'd MMM, HH:mm' };
const es = { MeetingTitleFormat: 'Reunión {0}', MeetingTitleDateFormat: 'd MMM, HH:mm' };

describe('defaultMeetingTitle', () => {
  it('formats the English example', () => {
    expect(defaultMeetingTitle(new Date(2026, 10, 2, 14, 5), 'en', en)).toBe(
      'Meeting 2 Nov, 14:05',
    );
  });
  it('formats Spanish', () => {
    expect(defaultMeetingTitle(new Date(2026, 10, 2, 14, 5), 'es', es)).toMatch(
      /^Reunión 2 nov\.?, 14:05$/,
    );
  });
  it('is recomputed from the new clock on every call (reset for the next take)', () => {
    const first = defaultMeetingTitle(new Date(2026, 10, 2, 14, 5), 'en', en);
    const second = defaultMeetingTitle(new Date(2026, 10, 2, 15, 30), 'en', en);
    expect(first).not.toBe(second);
    expect(second).toBe('Meeting 2 Nov, 15:30');
  });
});

describe('placeholderFormats', () => {
  it('exposes both languages so a Spanish placeholder is recognized (B-1)', () => {
    const formats = placeholderFormats({ en, es });
    expect(formats).toEqual(['Meeting {0}', 'Reunión {0}']);
    const patterns = placeholderPatternsFromFormats(formats);
    expect(looksLikePlaceholder('Reunión 2 nov, 14:05', patterns)).toBe(true);
    expect(looksLikePlaceholder('Meeting 2 Nov, 14:05', patterns)).toBe(true);
    expect(looksLikePlaceholder('Budget review', patterns)).toBe(false);
  });
});
