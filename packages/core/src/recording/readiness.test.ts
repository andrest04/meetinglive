import { describe, expect, it } from 'vitest';
import { readSettings, type AppSettings } from '../library/settings';
import {
  evaluateReadiness,
  evaluateSetup,
  parseSummaryProvider,
  type ReadinessInput,
  type RecordingSetupPorts,
} from './readiness';

const ready: ReadinessInput = {
  liveTranscriptionEnabled: true,
  engineReady: true,
  summaryProviderChosen: true,
  localSummarySelected: true,
  localModelDownloaded: true,
  cliOnPath: false,
};

describe('evaluateReadiness (RecordingReadinessEvaluatorTests)', () => {
  it('live on + all ready -> can record', () => {
    const r = evaluateReadiness(ready);
    expect(r).toEqual({
      liveRequired: true,
      liveReady: true,
      engineReady: true,
      summaryReady: true,
      canRecord: true,
    });
  });
  it('live off + engine missing -> cannot (live off does not waive the engine)', () => {
    const r = evaluateReadiness({ ...ready, liveTranscriptionEnabled: false, engineReady: false });
    expect(r.canRecord).toBe(false);
    expect(r.liveRequired).toBe(false);
  });
  it('live off + engine ready -> can', () => {
    expect(evaluateReadiness({ ...ready, liveTranscriptionEnabled: false }).canRecord).toBe(true);
  });
  it('live on + engine missing -> cannot', () => {
    const r = evaluateReadiness({ ...ready, engineReady: false });
    expect(r.canRecord).toBe(false);
    expect(r.liveReady).toBe(false);
  });
  it('provider unset -> cannot', () => {
    expect(evaluateReadiness({ ...ready, summaryProviderChosen: false }).canRecord).toBe(false);
  });
  it('Local + model missing -> cannot', () => {
    expect(evaluateReadiness({ ...ready, localModelDownloaded: false }).canRecord).toBe(false);
  });
  it('Local + model downloaded -> summary ready', () => {
    expect(evaluateReadiness(ready).summaryReady).toBe(true);
  });
  it('CLI + missing from PATH -> cannot', () => {
    const r = evaluateReadiness({ ...ready, localSummarySelected: false, cliOnPath: false });
    expect(r.canRecord).toBe(false);
  });
  it('CLI on PATH -> can (a downloaded local model does not count)', () => {
    const r = evaluateReadiness({
      ...ready,
      localSummarySelected: false,
      localModelDownloaded: false,
      cliOnPath: true,
    });
    expect(r.canRecord).toBe(true);
  });
});

describe('parseSummaryProvider (B-20, one rule)', () => {
  it('accepts only the exact enum names', () => {
    expect(parseSummaryProvider('Local')).toBe('Local');
    expect(parseSummaryProvider('ClaudeCode')).toBe('ClaudeCode');
    expect(parseSummaryProvider('Codex')).toBe('Codex');
    expect(parseSummaryProvider('Xai')).toBe('Xai');
  });
  it.each([null, undefined, '', '   ', 'local', 'CODEX', '1', '0', 'Gemini'])(
    'treats %j as not chosen',
    (value) => {
      expect(parseSummaryProvider(value)).toBeNull();
    },
  );
});

interface World {
  settings: Partial<AppSettings>;
  files?: string[];
  cli?: string[];
  engine?: boolean;
}

const MODEL = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';

const portsFor = (world: World): RecordingSetupPorts => ({
  loadSettings: () => Promise.resolve({ ...readSettings({}), ...world.settings }),
  localModelFileExists: (name) => Promise.resolve((world.files ?? []).includes(name)),
  cliOnPath: (kind) => Promise.resolve((world.cli ?? []).includes(kind)),
  engineReady: () => Promise.resolve(world.engine ?? true),
});

describe('evaluateSetup (resolver)', () => {
  it('blank provider is not chosen, so it cannot record even with a model on disk', async () => {
    const { facts, readiness } = await evaluateSetup(
      portsFor({
        settings: { selectedSummaryProvider: null, selectedSummaryModelId: MODEL },
        files: [MODEL],
      }),
    );
    expect(facts.summaryProviderChosen).toBe(false);
    expect(readiness.canRecord).toBe(false);
  });
  it('an unparsable provider is not chosen', async () => {
    const { facts } = await evaluateSetup(portsFor({ settings: { selectedSummaryProvider: '2' } }));
    expect(facts.provider).toBeNull();
    expect(facts.summaryProviderChosen).toBe(false);
  });
  it('Local needs a catalog model whose file is on disk', async () => {
    const base = { selectedSummaryProvider: 'Local', selectedSummaryModelId: MODEL };
    const onDisk = await evaluateSetup(portsFor({ settings: base, files: [MODEL] }));
    expect(onDisk.facts.localModelDownloaded).toBe(true);
    expect(onDisk.readiness.canRecord).toBe(true);
    const missing = await evaluateSetup(portsFor({ settings: base, files: [] }));
    expect(missing.readiness.canRecord).toBe(false);
    const unknown = await evaluateSetup(
      portsFor({
        settings: { ...base, selectedSummaryModelId: 'mystery.gguf' },
        files: ['mystery.gguf'],
      }),
    );
    expect(unknown.facts.localModelDownloaded).toBe(false);
    const blank = await evaluateSetup(
      portsFor({ settings: { ...base, selectedSummaryModelId: ' ' }, files: [' '] }),
    );
    expect(blank.facts.localModelDownloaded).toBe(false);
  });
  it('a CLI provider is ready only when its own executable is on PATH', async () => {
    const claude = { selectedSummaryProvider: 'ClaudeCode' };
    expect(
      (await evaluateSetup(portsFor({ settings: claude, cli: ['ClaudeCode'] }))).readiness
        .canRecord,
    ).toBe(true);
    expect(
      (await evaluateSetup(portsFor({ settings: claude, cli: ['Codex'] }))).readiness.canRecord,
    ).toBe(false);
    const codex = { selectedSummaryProvider: 'Codex' };
    expect(
      (await evaluateSetup(portsFor({ settings: codex, cli: ['Codex'] }))).readiness.canRecord,
    ).toBe(true);
  });
  it('Xai is never ready and flags the removal, whatever else is installed', async () => {
    const { facts, readiness } = await evaluateSetup(
      portsFor({
        settings: { selectedSummaryProvider: 'Xai' },
        cli: ['ClaudeCode', 'Codex'],
        files: [MODEL],
      }),
    );
    expect(facts.summaryProviderRemoved).toBe(true);
    expect(facts.summaryProviderChosen).toBe(false);
    expect(readiness.summaryReady).toBe(false);
    expect(readiness.canRecord).toBe(false);
  });
  it('other providers do not set the removal flag', async () => {
    const { facts } = await evaluateSetup(
      portsFor({ settings: { selectedSummaryProvider: 'Local' } }),
    );
    expect(facts.summaryProviderRemoved).toBe(false);
  });
  it('carries the live setting and the engine fact through', async () => {
    const { facts, readiness } = await evaluateSetup(
      portsFor({
        settings: {
          liveTranscriptionEnabled: false,
          selectedSummaryProvider: 'Local',
          selectedSummaryModelId: MODEL,
        },
        files: [MODEL],
        engine: false,
      }),
    );
    expect(facts.liveTranscriptionEnabled).toBe(false);
    expect(readiness.canRecord).toBe(false);
  });
});
