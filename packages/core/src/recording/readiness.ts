import type { AppSettings, SummaryProviderKind } from '../library/settings';
import { SUMMARY_PROVIDERS } from '../library/settings';
import { findSummaryModel } from '../settings/summary-models';

/** Readiness gate for Record and Import (spec 3.2). Pure rules plus a fact gatherer behind ports. */

export interface ReadinessInput {
  readonly liveTranscriptionEnabled: boolean;
  readonly engineReady: boolean;
  readonly summaryProviderChosen: boolean;
  readonly localSummarySelected: boolean;
  readonly localModelDownloaded: boolean;
  readonly cliOnPath: boolean;
}

export interface Readiness {
  readonly liveRequired: boolean;
  readonly liveReady: boolean;
  readonly engineReady: boolean;
  readonly summaryReady: boolean;
  readonly canRecord: boolean;
}

export function evaluateReadiness(input: ReadinessInput): Readiness {
  const summaryReady =
    input.summaryProviderChosen &&
    (input.localSummarySelected ? input.localModelDownloaded : input.cliOnPath);
  return {
    liveRequired: input.liveTranscriptionEnabled,
    // Live streaming shares the offline engine, so turning live off never waives it.
    liveReady: input.engineReady,
    engineReady: input.engineReady,
    summaryReady,
    canRecord: input.engineReady && summaryReady,
  };
}

/**
 * The one provider parse rule (B-20): the exact, case-sensitive enum name. Blank, numeric or
 * unknown text is "not chosen", for readiness and for everything else.
 */
export function parseSummaryProvider(value: string | null | undefined): SummaryProviderKind | null {
  return SUMMARY_PROVIDERS.find((kind) => kind === value) ?? null;
}

/** Ports the resolver reads facts through. Adapters live in the main process. */
export interface RecordingSetupPorts {
  loadSettings(): Promise<AppSettings>;
  /** The file for a summary model exists in the models folder. */
  localModelFileExists(fileName: string): Promise<boolean>;
  /** The CLI executable resolves on PATH. Sign-in is not checked. */
  cliOnPath(kind: 'ClaudeCode' | 'Codex'): Promise<boolean>;
  /** The Nemotron model is on disk and the CUDA or CPU runtime is ready. */
  engineReady(): Promise<boolean>;
}

export interface SetupFacts extends ReadinessInput {
  readonly provider: SummaryProviderKind | null;
  readonly summaryModelId: string | null;
  /** The settings file still selects the removed xAI provider (owner cut 2026-11-03). */
  readonly summaryProviderRemoved: boolean;
}

export interface SetupEvaluation {
  readonly facts: SetupFacts;
  readonly readiness: Readiness;
}

/** Gathers the facts for the readiness rules. Xai is never ready and has no credential path. */
export async function gatherSetupFacts(ports: RecordingSetupPorts): Promise<SetupFacts> {
  const settings = await ports.loadSettings();
  const provider = parseSummaryProvider(settings.selectedSummaryProvider);
  const modelId = settings.selectedSummaryModelId;
  const localModelDownloaded =
    provider === 'Local' &&
    modelId !== null &&
    modelId.trim() !== '' &&
    findSummaryModel(modelId) !== null &&
    (await ports.localModelFileExists(modelId));
  const cliOnPath =
    provider === 'ClaudeCode' || provider === 'Codex' ? await ports.cliOnPath(provider) : false;
  const removed = provider === 'Xai';
  return {
    provider,
    summaryModelId: modelId,
    summaryProviderRemoved: removed,
    liveTranscriptionEnabled: settings.liveTranscriptionEnabled,
    engineReady: await ports.engineReady(),
    summaryProviderChosen: provider !== null && !removed,
    localSummarySelected: provider === 'Local',
    localModelDownloaded,
    cliOnPath,
  };
}

export async function evaluateSetup(ports: RecordingSetupPorts): Promise<SetupEvaluation> {
  const facts = await gatherSetupFacts(ports);
  return { facts, readiness: evaluateReadiness(facts) };
}
