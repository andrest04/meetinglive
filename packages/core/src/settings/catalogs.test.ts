import { describe, expect, it } from 'vitest';
import { readSettings, resolveSummaryLanguage, resolveTranscriptionLanguage } from '../library';
import { cliExecutableName } from './cli-providers';
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  CODEX_EFFORTS,
  CODEX_MODELS,
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
  FIT_LABEL_KEYS,
  SUMMARY_MODELS,
  formatModelSize,
  rateFor,
  type HardwareProfile,
  type SummaryModelInfo,
} from './summary-models';

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

  it('B18: pins the exact byte size of every file and the hash of the 1B file only', () => {
    expect(SUMMARY_MODELS.map((m) => m.sizeBytes)).toEqual([
      807_694_464, 3_106_738_272, 4_977_171_584, 7_121_861_440,
    ]);
    for (const model of SUMMARY_MODELS) {
      expect(Number.isInteger(model.sizeBytes)).toBe(true);
      // The rounded GB label agrees with the byte size.
      expect(Math.round((model.sizeBytes / 1e9) * 100) / 100).toBe(model.fileSizeGb);
    }
    expect(SUMMARY_MODELS.map((m) => m.sha256)).toEqual([
      '6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83',
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('B20: the catalog holds label keys, never translated text', () => {
    for (const model of SUMMARY_MODELS) {
      for (const key of [model.speedKey, model.qualityKey, model.useCaseKey]) {
        expect(key).toMatch(/^Model(Speed|Quality|UseCase)[A-Za-z0-9]+$/);
        expect(key).not.toContain(' ');
      }
    }
    for (const key of Object.values(FIT_LABEL_KEYS)) expect(key).toMatch(/^Ui_Fit[A-Za-z]+$/);
  });

  it('labels the fit as hardware fit, not as a pick (settings polish T2)', () => {
    expect(FIT_LABEL_KEYS).toEqual({
      Recommended: 'Ui_FitRunsWell',
      MayBeSlow: 'Ui_FitMayBeSlow',
      NotRecommended: 'Ui_FitTooHeavy',
    });
  });

  it('pins every URL, size and catalog key', () => {
    expect(
      SUMMARY_MODELS.map((m) => [
        m.downloadUrl,
        m.fileSizeGb,
        m.speedKey,
        m.qualityKey,
        m.useCaseKey,
      ]),
    ).toEqual([
      [
        'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
        0.81,
        'ModelSpeedVeryFast',
        'ModelQualityGood',
        'ModelUseCaseModestPcs',
      ],
      [
        'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
        3.11,
        'ModelSpeedFast',
        'ModelQualityVeryGood',
        'ModelUseCaseRecommendedDefault',
      ],
      [
        'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
        4.98,
        'ModelSpeedMedium',
        'ModelQualityExcellent',
        'ModelUseCasePc16GbOrGpu',
      ],
      [
        'https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf',
        7.12,
        'ModelSpeedSlowWithoutGpu',
        'ModelQualityExcellent',
        'ModelUseCaseGpuOnly',
      ],
    ]);
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

describe('fit rating by runtime backend (B17)', () => {
  const model: SummaryModelInfo = { ...SUMMARY_MODELS[3]!, minRamGb: 16 };
  const gpu: HardwareProfile = { totalRamGb: 8, gpuName: 'GPU', gpuVramGb: 8 };

  it('a CPU backend cannot use the VRAM, a GPU backend can', () => {
    expect(rateFor(model, gpu, { gpuOffload: false })).toBe('NotRecommended');
    expect(rateFor(model, gpu, { gpuOffload: true })).toBe('Recommended');
  });

  it('the default keeps the GPU rule', () => {
    expect(rateFor(model, gpu)).toBe('Recommended');
    expect(rateFor(model, gpu, {})).toBe('Recommended');
  });

  it('the RAM rules do not depend on the backend (boundaries 1.0, 0.75)', () => {
    const cpu = { gpuOffload: false };
    const ram = (gb: number): HardwareProfile => ({
      totalRamGb: gb,
      gpuName: null,
      gpuVramGb: null,
    });
    expect(rateFor(model, ram(16), cpu)).toBe('Recommended');
    expect(rateFor(model, ram(12), cpu)).toBe('MayBeSlow');
    expect(rateFor(model, ram(11.9), cpu)).toBe('NotRecommended');
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
