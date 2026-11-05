import { describe, expect, it } from 'vitest';
import { highlightParts, mergeMatches, snippetAroundMatch, tabOfHit } from './search-results';

const item = (id: string) => ({ id }) as never;
const hit = (meetingId: string, field: 'title' | 'summary' | 'notes' | 'transcript') => ({
  meetingId,
  field,
  snippet: null,
});

describe('mergeMatches', () => {
  it('keeps the date order of the view, with title matches and hits together', () => {
    const view = [item('new'), item('mid'), item('old')];
    const merged = mergeMatches(view, [item('old')], new Map([['new', hit('new', 'transcript')]]));
    expect(merged.map((m: { id: string }) => m.id)).toEqual(['new', 'old']);
  });

  it('leaves out a hit that is no longer in the view', () => {
    const merged = mergeMatches([item('a')], [], new Map([['gone', hit('gone', 'summary')]]));
    expect(merged).toEqual([]);
  });
});

describe('tabOfHit', () => {
  it('opens what was found: notes live on the Summary tab', () => {
    expect(tabOfHit(hit('a', 'transcript'))).toBe('Transcript');
    expect(tabOfHit(hit('a', 'summary'))).toBe('Summary');
    expect(tabOfHit(hit('a', 'notes'))).toBe('Summary');
  });

  it('has no opinion on a title hit or no hit', () => {
    expect(tabOfHit(hit('a', 'title'))).toBeNull();
    expect(tabOfHit(undefined)).toBeNull();
  });
});

describe('highlightParts', () => {
  it('marks every word, ignoring case and accents, on the original text', () => {
    expect(highlightParts('El Año fiscal, otro ano', 'ano FISCAL')).toEqual([
      { text: 'El ', mark: false },
      { text: 'Año', mark: true },
      { text: ' ', mark: false },
      { text: 'fiscal', mark: true },
      { text: ', otro ', mark: false },
      { text: 'ano', mark: true },
    ]);
  });

  it('joins words that overlap', () => {
    expect(highlightParts('roadmap', 'road adma')).toEqual([
      { text: 'roadma', mark: true },
      { text: 'p', mark: false },
    ]);
  });

  it('is the plain text with no words', () => {
    expect(highlightParts('Standup', '   ')).toEqual([{ text: 'Standup', mark: false }]);
  });
});

describe('snippetAroundMatch', () => {
  const text = 'the team agreed that Luis checks the installer on a clean machine';

  it('brings a match far along the text to the start, so a narrow row still shows it', () => {
    const shown = snippetAroundMatch(text, 'installer');
    expect(shown.startsWith('…')).toBe(true);
    expect(shown.indexOf('installer')).toBeLessThan(16);
    expect(shown.endsWith('clean machine')).toBe(true);
  });

  it('cuts at a word, never inside one', () => {
    expect(snippetAroundMatch(text, 'installer')).toBe('…checks the installer on a clean machine');
  });

  it('leaves the text alone when the match is already near the start', () => {
    expect(snippetAroundMatch(text, 'team')).toBe(text);
  });

  it('leaves the text alone with no query or no match', () => {
    expect(snippetAroundMatch(text, '')).toBe(text);
    expect(snippetAroundMatch(text, 'absent')).toBe(text);
  });
});
