import { describe, expect, it } from 'vitest';
import { resolveTranscriptionStage } from '../../transcription/pipeline-rules';
import { shouldSaveBeforeTranscribing } from './rules';

describe('shouldSaveBeforeTranscribing', () => {
  it('saves first when there is a live draft, even over the same audio', () => {
    expect(shouldSaveBeforeTranscribing('draft', 'a.wav', 'a.wav')).toBe(true);
  });

  it('saves first for a new take with no draft (the audio is new)', () => {
    expect(shouldSaveBeforeTranscribing(null, null, 'a.wav')).toBe(true);
    expect(shouldSaveBeforeTranscribing(null, 'old.wav', 'a.wav')).toBe(true);
  });

  it('does not save first when the meeting already points at this audio, ignoring case', () => {
    expect(shouldSaveBeforeTranscribing(null, 'C:/Lib/A.WAV', 'c:/lib/a.wav')).toBe(false);
  });

  it('treats a blank draft as no draft', () => {
    expect(shouldSaveBeforeTranscribing('  \n', 'a.wav', 'a.wav')).toBe(false);
  });
});

describe('resolveTranscriptionStage', () => {
  it('prefers a non-blank offline transcript, even after a failure', () => {
    expect(resolveTranscriptionStage('draft', 'offline', false)).toBe('OfflineTranscript');
    expect(resolveTranscriptionStage(null, 'offline', true)).toBe('OfflineTranscript');
  });

  it('keeps the draft silently when the pass produced nothing', () => {
    expect(resolveTranscriptionStage('draft', '  ', false)).toBe('LiveDraft');
    expect(resolveTranscriptionStage('draft', null, false)).toBe('LiveDraft');
  });

  it('keeps the draft with a warning when the pass failed', () => {
    expect(resolveTranscriptionStage('draft', null, true)).toBe('LiveDraftAfterFailure');
  });

  it('reports a failure when there is nothing to keep', () => {
    expect(resolveTranscriptionStage(null, null, true)).toBe('FailedWithoutTranscript');
    expect(resolveTranscriptionStage('  ', '', true)).toBe('FailedWithoutTranscript');
  });

  it('reports no transcript when nothing failed and nothing was produced', () => {
    expect(resolveTranscriptionStage(null, '', false)).toBe('NoTranscript');
  });
});
