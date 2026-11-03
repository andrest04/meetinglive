import { describe, expect, it } from 'vitest';
import { deriveTabFlags, type TabFlagInput } from './tab-state';

const base: TabFlagInput = {
  hasMeeting: true,
  summary: '',
  transcript: 'Ana: hi',
  isShowingNotes: false,
  isLoading: false,
  isGenerating: false,
};

describe('deriveTabFlags (spec 2.2 table, item 81)', () => {
  it('transcript without summary can generate', () => {
    const f = deriveTabFlags(base);
    expect(f).toMatchObject({
      hasSummary: false,
      canGenerate: true,
      canRegenerate: false,
      showEnhancedChrome: true,
      showNoteTemplate: true,
      showSummaryActionBar: true,
      showDraftActions: false,
      isEmpty: false,
      canExecuteGenerate: true,
      canExecuteRegenerate: false,
    });
  });

  it('transcript and summary can regenerate and show draft actions', () => {
    const f = deriveTabFlags({ ...base, summary: '### Summary' });
    expect(f).toMatchObject({
      hasSummary: true,
      canGenerate: false,
      canRegenerate: true,
      showNoteTemplate: true,
      showDraftActions: true,
      isEmpty: false,
    });
  });

  it('a summary without a transcript hides the action bar', () => {
    const f = deriveTabFlags({ ...base, summary: 'x', transcript: null });
    expect(f).toMatchObject({
      hasSummary: true,
      canGenerate: false,
      canRegenerate: false,
      showNoteTemplate: false,
      showSummaryActionBar: false,
      showDraftActions: true,
      isEmpty: false,
    });
  });

  it('neither summary nor transcript is empty, unless loading', () => {
    const input = { ...base, transcript: '   ' };
    expect(deriveTabFlags(input).isEmpty).toBe(true);
    expect(deriveTabFlags({ ...input, isLoading: true }).isEmpty).toBe(false);
  });

  it('whitespace summary is no summary', () => {
    expect(deriveTabFlags({ ...base, summary: '  \n' }).hasSummary).toBe(false);
  });

  it('notes mode turns off the enhanced chrome, template and draft actions', () => {
    const f = deriveTabFlags({ ...base, summary: 'x', isShowingNotes: true });
    expect(f).toMatchObject({
      showEnhancedChrome: false,
      showNoteTemplate: false,
      showSummaryActionBar: false,
      showDraftActions: false,
      canRegenerate: true,
    });
  });

  it('generating blocks the execute flags only', () => {
    const f = deriveTabFlags({ ...base, isGenerating: true });
    expect(f.canGenerate).toBe(true);
    expect(f.canExecuteGenerate).toBe(false);
  });

  it('no meeting: empty, nothing to do', () => {
    const f = deriveTabFlags({ ...base, hasMeeting: false, summary: '', transcript: null });
    expect(f).toMatchObject({ canGenerate: false, canRegenerate: false, isEmpty: true });
  });
});
