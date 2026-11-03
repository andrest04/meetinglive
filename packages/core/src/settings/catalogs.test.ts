import { describe, expect, it } from 'vitest';
import { readSettings, resolveSummaryLanguage, resolveTranscriptionLanguage } from '../library';
import { cliExecutableName } from './cli-providers';
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  CODEX_EFFORTS,
  CODEX_MODELS,
  XAI_EFFORTS,
  optionsIncluding,
} from './inference-options';
import {
  SUMMARY_LANGUAGES,
  TRANSCRIPTION_LANGUAGES,
  engineLocaleFor,
  resolveMeetingLanguageCode,
  resolveSummaryLanguageCode,
} from './languages';
import {
  NOTE_TEMPLATE_BUILT_INS,
  instructionsFor,
  noteTemplateOptions,
  normalizeTemplateId,
} from './note-templates';
import {
  SUMMARY_MODELS,
  formatModelSize,
  rateFor,
  type HardwareProfile,
  type SummaryModelInfo,
} from './summary-models';
import { DEFAULT_XAI_MODEL_ID, mergeModelList, resolveXaiModelId } from './xai';

const defaults = readSettings({});

describe('language catalogs', () => {
  it('transcription: auto first, then the nine languages, in order', () => {
    expect(TRANSCRIPTION_LANGUAGES.map((l) => l.code)).toEqual([
      'auto',
      'en',
      'es',
      'pt',
      'fr',
      'de',
      'it',
      'nl',
      'ja',
      'zh',
    ]);
  });

  it('summary: es then en', () => {
    expect(SUMMARY_LANGUAGES.map((l) => l.code)).toEqual(['es', 'en']);
  });

  it('every label key is a CoreStrings language key', () => {
    for (const entry of [...TRANSCRIPTION_LANGUAGES, ...SUMMARY_LANGUAGES]) {
      expect(entry.labelKey).toMatch(/^Language[A-Z][a-z]+(Detect)?$|^LanguageAutoDetect$/);
    }
  });
});

describe('engine locale mapper', () => {
  it.each([
    ['auto', 'auto'],
    ['en', 'en-US'],
    ['es', 'es-US'],
    ['pt', 'pt-BR'],
    ['fr', 'fr-FR'],
    ['de', 'de-DE'],
    ['it', 'it-IT'],
    ['nl', 'nl-NL'],
    ['ja', 'ja-JP'],
    ['zh', 'zh-CN'],
  ])('%s maps to %s', (code, locale) => {
    expect(engineLocaleFor(code)).toBe(locale);
  });

  it('trims, lowercases, maps blank and unknown codes to auto', () => {
    expect(engineLocaleFor('  ES ')).toBe('es-US');
    expect(engineLocaleFor('')).toBe('auto');
    expect(engineLocaleFor(null)).toBe('auto');
    expect(engineLocaleFor('klingon')).toBe('auto');
  });
});

describe('B6: the picker and the engine agree on case and space variants', () => {
  it.each(['ES', ' en ', 'Pt', 'AUTO'])('transcription %j', (stored) => {
    const code = resolveMeetingLanguageCode(stored);
    expect(TRANSCRIPTION_LANGUAGES.some((l) => l.code === code)).toBe(true);
    expect(code).toBe(stored.trim().toLowerCase());
    expect(engineLocaleFor(code)).toBe(engineLocaleFor(stored));
  });

  it('transcription: blank is es, an unknown code is auto like the engine', () => {
    expect(resolveMeetingLanguageCode(null)).toBe('es');
    expect(resolveMeetingLanguageCode('  ')).toBe('es');
    expect(resolveMeetingLanguageCode('klingon')).toBe('auto');
    expect(engineLocaleFor(resolveMeetingLanguageCode('klingon'))).toBe('auto');
  });

  it('summary: case variants resolve to the catalog code, unknown codes to es', () => {
    expect(resolveSummaryLanguageCode(' EN ')).toBe('en');
    expect(resolveSummaryLanguageCode('Es')).toBe('es');
    expect(resolveSummaryLanguageCode('fr')).toBe('es');
    expect(resolveSummaryLanguageCode(null)).toBe('es');
  });

  it('the settings resolvers use the same rules', () => {
    expect(resolveTranscriptionLanguage({ ...defaults, transcriptionLanguage: ' ES ' })).toBe('es');
    expect(resolveTranscriptionLanguage({ ...defaults, transcriptionLanguage: 'AUTO' })).toBe(
      'auto',
    );
    expect(resolveSummaryLanguage({ ...defaults, summaryLanguage: 'EN' })).toBe('en');
    expect(resolveSummaryLanguage({ ...defaults, summaryLanguage: 'xx' })).toBe('es');
  });
});

describe('summary model catalog', () => {
  it('has the four curated entries', () => {
    expect(SUMMARY_MODELS.map((m) => m.fileName)).toEqual([
      'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
      'gemma-4-E2B-it-Q4_K_M.gguf',
      'gemma-4-E4B-it-Q4_K_M.gguf',
      'gemma-4-12b-it-Q4_K_M.gguf',
    ]);
    expect(SUMMARY_MODELS.map((m) => m.displayName)).toEqual([
      'Llama 3.2 1B Instruct',
      'Gemma 4 E2B Instruct',
      'Gemma 4 E4B Instruct',
      'Gemma 4 12B Instruct',
    ]);
  });

  it('is ordered by ascending minimum RAM', () => {
    const rams = SUMMARY_MODELS.map((m) => m.minRamGb);
    expect(rams).toEqual([4, 6, 8, 16]);
    expect([...rams].sort((a, b) => a - b)).toEqual(rams);
  });

  it('all have https download URLs and a positive size', () => {
    for (const model of SUMMARY_MODELS) {
      expect(model.downloadUrl.startsWith('https://')).toBe(true);
      expect(model.downloadUrl.endsWith(model.fileName)).toBe(true);
      expect(model.fileSizeGb).toBeGreaterThan(0);
    }
  });

  it('carries the catalog keys for speed, quality and use case', () => {
    const e2b = SUMMARY_MODELS[1];
    expect(e2b).toMatchObject({
      speedKey: 'ModelSpeedFast',
      qualityKey: 'ModelQualityVeryGood',
      useCaseKey: 'ModelUseCaseRecommendedDefault',
    });
  });

  it('formats the size with the 0.# pattern', () => {
    expect(SUMMARY_MODELS.map((m) => formatModelSize(m.fileSizeGb, 'en'))).toEqual([
      '0.8',
      '3.1',
      '5',
      '7.1',
    ]);
    expect(formatModelSize(7.12, 'es')).toBe('7,1');
  });
});

describe('fit rating', () => {
  const model: SummaryModelInfo = { ...SUMMARY_MODELS[3]!, minRamGb: 16 };
  const hw = (totalRamGb: number, gpuVramGb: number | null = null): HardwareProfile => ({
    totalRamGb,
    gpuName: gpuVramGb === null ? null : 'GPU',
    gpuVramGb,
  });

  it('recommended when RAM meets the minimum, exactly', () => {
    expect(rateFor(model, hw(16))).toBe('Recommended');
    expect(rateFor(model, hw(32))).toBe('Recommended');
  });

  it('may be slow from exactly 0.75 of the minimum', () => {
    expect(rateFor(model, hw(12))).toBe('MayBeSlow');
    expect(rateFor(model, hw(15.9))).toBe('MayBeSlow');
    expect(rateFor(model, hw(11.9))).toBe('NotRecommended');
  });

  it('not recommended far below', () => {
    expect(rateFor(model, hw(4))).toBe('NotRecommended');
  });

  it('a dedicated GPU with VRAM of at least half the minimum is recommended', () => {
    expect(rateFor(model, hw(8, 8))).toBe('Recommended');
    expect(rateFor(model, hw(8, 7.9))).toBe('NotRecommended');
  });

  it('no GPU, zero VRAM or null VRAM do not count as a dedicated GPU', () => {
    expect(rateFor(model, hw(8, 0))).toBe('NotRecommended');
    expect(rateFor(model, hw(8, null))).toBe('NotRecommended');
    expect(rateFor(model, hw(12, 0))).toBe('MayBeSlow');
  });
});

describe('note templates', () => {
  it('auto and unknown give no instructions', () => {
    for (const id of ['auto', 'custom', '', '  ', 'nope', null]) {
      expect(instructionsFor(id)).toBeNull();
    }
  });

  it('built-ins name the required shape, verbatim', () => {
    expect(instructionsFor('one-on-one')).toBe(
      'Shape the enhanced notes as a 1:1. Include decisions, feedback, and commitments that were actually stated. Omit a heading if that content is not in the sources.',
    );
    expect(instructionsFor('standup')).toBe(
      'Shape the enhanced notes as a standup. Include yesterday, today, and blockers that were actually stated. Omit a heading if that content is not in the sources.',
    );
    expect(instructionsFor('sales')).toBe(
      'Shape the enhanced notes as a sales call. Include pain, decision process, next step, and objections that were actually stated. Omit a heading if that content is not in the sources.',
    );
    expect(instructionsFor(' user-interview ')).toBe(
      'Shape the enhanced notes as a user interview. Include what they tried, quotes, and jobs-to-be-done. Quotes must be taken from the transcript or the raw notes. Do not invent quotes.',
    );
  });

  it('normalizes ids', () => {
    expect(normalizeTemplateId(null)).toBeNull();
    expect(normalizeTemplateId('  ')).toBeNull();
    expect(normalizeTemplateId(' AUTO ')).toBeNull();
    expect(normalizeTemplateId(' standup ')).toBe('standup');
    expect(normalizeTemplateId('custom')).toBe('custom');
  });

  it('options: the five built-ins in order, then a named custom template', () => {
    expect(NOTE_TEMPLATE_BUILT_INS.map((t) => t.id)).toEqual([
      'auto',
      'one-on-one',
      'standup',
      'sales',
      'user-interview',
    ]);
    expect(noteTemplateOptions(null).map((o) => o.id)).toHaveLength(5);
    expect(noteTemplateOptions({ name: '   ' }).map((o) => o.id)).toHaveLength(5);
    const withCustom = noteTemplateOptions({ name: '  Retro  ' });
    expect(withCustom.at(-1)).toEqual({ id: 'custom', labelKey: null, name: 'Retro' });
    expect(withCustom).toHaveLength(6);
  });
});

describe('xai model resolution', () => {
  it.each([
    [null, ['grok-4.3', 'grok-4.6'], 'grok-4.6'],
    ['', ['grok-4.3'], 'grok-4.3'],
    ['grok-4.3', ['grok-4.3', 'grok-4.6'], 'grok-4.3'],
    ['grok-imagine-image', ['grok-4.6'], 'grok-4.6'],
    [null, [], 'grok-4.6'],
  ])('(%j, %j) gives %s', (selected, listed, expected) => {
    expect(resolveXaiModelId(selected, listed)).toBe(expected);
  });

  it('the saved id wins ignoring case and keeps its own casing', () => {
    expect(resolveXaiModelId('GROK-4.3', ['grok-4.3', 'grok-4.6'])).toBe('GROK-4.3');
  });

  it('preferred order, listed casing, then the first listed', () => {
    expect(resolveXaiModelId(null, ['x', 'Grok-4.3', 'grok-4.7'])).toBe('grok-4.7');
    expect(resolveXaiModelId(null, ['x', 'Grok-4.5'])).toBe('Grok-4.5');
    expect(resolveXaiModelId(null, ['zeta', 'alpha'])).toBe('zeta');
    expect(DEFAULT_XAI_MODEL_ID).toBe('grok-4.6');
  });

  it('an empty list gives the default whatever was saved', () => {
    expect(resolveXaiModelId('grok-9', [])).toBe('grok-4.6');
  });
});

describe('xai model list merge', () => {
  it('removes absent entries and inserts missing ones at their index', () => {
    expect(mergeModelList(['a', 'b', 'c'], ['b', 'd'], 'b')).toEqual(['b', 'd']);
    expect(mergeModelList(['b'], ['a', 'b', 'c'], 'b')).toEqual(['a', 'b', 'c']);
  });

  it('always keeps the resolved id, appended when it is not listed', () => {
    expect(mergeModelList([], ['a'], 'z')).toEqual(['a', 'z']);
    expect(mergeModelList(['z'], [], 'z')).toEqual(['z']);
  });

  it('does not reorder entries that are present but out of place', () => {
    expect(mergeModelList(['b', 'a'], ['a', 'b'], 'a')).toEqual(['b', 'a']);
  });

  it('never returns an empty list when the resolved id is set', () => {
    expect(mergeModelList(['old'], ['new'], 'new').length).toBeGreaterThan(0);
  });
});

describe('B13: stored values that are not in the list', () => {
  it('the options keep the stored value so the control is never blank', () => {
    expect(optionsIncluding(CLAUDE_MODELS, 'gpt-9')).toEqual([...CLAUDE_MODELS, 'gpt-9']);
    expect(optionsIncluding(CLAUDE_MODELS, 'opus')).toEqual([...CLAUDE_MODELS]);
  });
});

describe('inference lists', () => {
  it('match the spec', () => {
    expect(CLAUDE_MODELS).toEqual(['sonnet', 'opus', 'haiku', 'fable']);
    expect(CLAUDE_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(CODEX_MODELS).toEqual(['gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-5.6-sol']);
    expect(CODEX_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(XAI_EFFORTS).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  });
});

describe('cli executable names', () => {
  it('claude and codex only', () => {
    expect(cliExecutableName('ClaudeCode')).toBe('claude');
    expect(cliExecutableName('Codex')).toBe('codex');
    expect(() => cliExecutableName('Local')).toThrow(/Only ClaudeCode and Codex/);
    expect(() => cliExecutableName('Xai')).toThrow(RangeError);
  });
});
