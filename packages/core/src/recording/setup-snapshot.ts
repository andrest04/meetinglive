import { findSummaryModel } from '../settings/summary-models';
import type { Readiness, SetupFacts } from './readiness';

/** What the setup checklist and the idle status show. Keys and args, never finished strings. */

export interface TextRef {
  readonly key: string;
  readonly args: readonly string[];
}

export interface SetupCard {
  readonly headerKey: string;
  readonly status: TextRef;
  readonly detail: TextRef;
  readonly ready: boolean;
}

export interface SetupSnapshot {
  readonly canRecord: boolean;
  readonly live: SetupCard;
  readonly engine: SetupCard;
  readonly summary: SetupCard;
  /** The xAI provider is gone but the settings file still selects it: ask for another one. */
  readonly summaryProviderRemoved: boolean;
  /** Shown only when idle (spec 2.4). */
  readonly idleStatus: TextRef;
}

const ref = (key: string, ...args: string[]): TextRef => ({ key, args });

/** Spec 2.4 summary caption. `Xai` and anything unknown read as "Not chosen". */
export function summaryCaption(provider: SetupFacts['provider'], modelId: string | null): TextRef {
  switch (provider) {
    case 'Local': {
      const model = findSummaryModel(modelId);
      return model === null
        ? ref('RecordingSetup_SummaryLocal')
        : ref('RecordingSetup_SummaryLocalModel', model.displayName);
    }
    case 'ClaudeCode':
      return ref('Cli_ClaudeName');
    case 'Codex':
      return ref('Cli_CodexName');
    default:
      return ref('RecordingSetup_SummaryNotChosen');
  }
}

const statusRef = (ready: boolean): TextRef =>
  ref(ready ? 'RecordingSetup_Ready' : 'RecordingSetup_NeedsSetup');

export function buildSetupSnapshot(facts: SetupFacts, readiness: Readiness): SetupSnapshot {
  return {
    canRecord: readiness.canRecord,
    live: {
      headerKey: 'RecordingSetup_Live.Header',
      status: readiness.liveRequired
        ? statusRef(readiness.liveReady)
        : ref('RecordingSetup_NotNeeded'),
      detail: ref(
        readiness.liveRequired ? 'RecordingSetup_LiveDetail' : 'RecordingSetup_LiveNotNeededDetail',
      ),
      ready: readiness.liveReady,
    },
    engine: {
      headerKey: 'RecordingSetup_Engine.Header',
      status: statusRef(readiness.engineReady),
      detail: ref('RecordingSetup_EngineDetail'),
      ready: readiness.engineReady,
    },
    summary: {
      headerKey: 'RecordingSetup_Summary.Header',
      status: statusRef(readiness.summaryReady),
      detail: summaryCaption(facts.provider, facts.summaryModelId),
      ready: readiness.summaryReady,
    },
    summaryProviderRemoved: facts.summaryProviderRemoved,
    idleStatus: ref(readiness.canRecord ? 'Status_ReadyToRecord' : 'Status_NeedsSetup'),
  };
}
