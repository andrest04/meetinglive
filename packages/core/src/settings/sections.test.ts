import { describe, expect, it } from 'vitest';
import { SETTINGS_MESSAGE_KEYS, SETTINGS_SECTIONS } from './sections';

describe('settings sections', () => {
  it('follow the order of the spec table, with the theme first', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      'appearance',
      'language',
      'summaryProvider',
      'typeSafe',
      'microphone',
      'meetingLanguage',
      'transcription',
      'recording',
      'calendar',
      'data',
      'about',
    ]);
  });

  it('this module owns the language, provider and meeting language blocks and they are built', () => {
    const own = SETTINGS_SECTIONS.filter((s) => s.owner === 'settings-i18n');
    expect(own.map((s) => s.id)).toEqual(['language', 'summaryProvider', 'meetingLanguage']);
    expect(own.every((s) => s.status === 'built')).toBe(true);
  });

  it('blocks that wait for a module are slots with a named owner', () => {
    const slots = SETTINGS_SECTIONS.filter((s) => s.status === 'slot');
    expect(slots.map((s) => [s.id, s.owner])).toEqual([
      ['typeSafe', 'jev-typesafe'],
      ['recording', 'recording'],
      ['calendar', 'calendar-detection'],
    ]);
  });

  it('every id and message key is unique', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = Object.values(SETTINGS_MESSAGE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
