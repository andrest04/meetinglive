import { describe, expect, it } from 'vitest';
import { evaluateReadiness, type SetupFacts } from './readiness';
import { buildSetupSnapshot, summaryCaption } from './setup-snapshot';

const facts = (patch: Partial<SetupFacts> = {}): SetupFacts => ({
  provider: 'Local',
  summaryModelId: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  summaryProviderRemoved: false,
  liveTranscriptionEnabled: true,
  engineReady: true,
  summaryProviderChosen: true,
  localSummarySelected: true,
  localModelDownloaded: true,
  cliOnPath: false,
  ...patch,
});

const snap = (patch: Partial<SetupFacts> = {}) => {
  const f = facts(patch);
  return buildSetupSnapshot(f, evaluateReadiness(f));
};

describe('summaryCaption', () => {
  it('maps each provider to a key and args', () => {
    expect(summaryCaption(null, null)).toEqual({
      key: 'RecordingSetup_SummaryNotChosen',
      args: [],
    });
    expect(summaryCaption('Local', '')).toEqual({ key: 'RecordingSetup_SummaryLocal', args: [] });
    expect(summaryCaption('Local', 'unknown.gguf')).toEqual({
      key: 'RecordingSetup_SummaryLocal',
      args: [],
    });
    expect(summaryCaption('Local', 'Llama-3.2-1B-Instruct-Q4_K_M.gguf')).toEqual({
      key: 'RecordingSetup_SummaryLocalModel',
      args: ['Llama 3.2 1B Instruct'],
    });
    expect(summaryCaption('ClaudeCode', null).key).toBe('Cli_ClaudeName');
    expect(summaryCaption('Codex', null).key).toBe('Cli_CodexName');
  });
  it('Xai maps to Not chosen', () => {
    expect(summaryCaption('Xai', null).key).toBe('RecordingSetup_SummaryNotChosen');
  });
});

describe('buildSetupSnapshot', () => {
  it('all ready: Ready cards, live detail, idle Ready to record', () => {
    const s = snap();
    expect(s.canRecord).toBe(true);
    expect(s.live.status.key).toBe('RecordingSetup_Ready');
    expect(s.live.detail.key).toBe('RecordingSetup_LiveDetail');
    expect(s.engine.status.key).toBe('RecordingSetup_Ready');
    expect(s.engine.detail.key).toBe('RecordingSetup_EngineDetail');
    expect(s.summary.status.key).toBe('RecordingSetup_Ready');
    expect(s.idleStatus.key).toBe('Status_ReadyToRecord');
  });
  it('live off: Not needed with the not-needed detail, engine still required', () => {
    const s = snap({ liveTranscriptionEnabled: false, engineReady: false });
    expect(s.live.status.key).toBe('RecordingSetup_NotNeeded');
    expect(s.live.detail.key).toBe('RecordingSetup_LiveNotNeededDetail');
    expect(s.engine.status.key).toBe('RecordingSetup_NeedsSetup');
    expect(s.idleStatus.key).toBe('Status_NeedsSetup');
  });
  it('live on and engine missing: both cards need setup', () => {
    const s = snap({ engineReady: false });
    expect(s.live.status.key).toBe('RecordingSetup_NeedsSetup');
    expect(s.engine.status.key).toBe('RecordingSetup_NeedsSetup');
  });
  it('summary card needs setup with a caption when the model is missing', () => {
    const s = snap({ localModelDownloaded: false });
    expect(s.summary.status.key).toBe('RecordingSetup_NeedsSetup');
    expect(s.summary.detail.key).toBe('RecordingSetup_SummaryLocalModel');
  });
  it('Xai: not chosen caption, removed flag, cannot record', () => {
    const s = snap({
      provider: 'Xai',
      summaryProviderRemoved: true,
      summaryProviderChosen: false,
      localSummarySelected: false,
    });
    expect(s.summary.detail.key).toBe('RecordingSetup_SummaryNotChosen');
    expect(s.summary.status.key).toBe('RecordingSetup_NeedsSetup');
    expect(s.summaryProviderRemoved).toBe(true);
    expect(s.canRecord).toBe(false);
  });
  it('uses the catalog header keys', () => {
    const s = snap();
    expect([s.live.headerKey, s.engine.headerKey, s.summary.headerKey]).toEqual([
      'RecordingSetup_Live.Header',
      'RecordingSetup_Engine.Header',
      'RecordingSetup_Summary.Header',
    ]);
  });
});
