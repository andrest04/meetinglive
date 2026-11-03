import { describe, expect, it } from 'vitest';
import { LibraryFileCorruptError } from './errors';
import {
  applySettingsPatch,
  disabledCalendarIdsAsSet,
  parseSettingsJson,
  readSettings,
  resolveClaudeEffort,
  resolveClaudeModelId,
  resolveCodexEffort,
  resolveCodexModelId,
  resolveNavigationPaneLength,
  resolvePillAlong,
  resolvePillEdge,
  resolveSummaryLanguage,
  resolveSummaryProviderKind,
  resolveTranscriptionLanguage,
  isProviderAvailable,
  serializeSettings,
  type AppSettings,
} from './settings';

const defaults = readSettings({});
const parseObject = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;

describe('defaults', () => {
  it('matches the spec table', () => {
    expect(defaults).toEqual<AppSettings>({
      selectedSummaryModelId: null,
      selectedSummaryProvider: null,
      selectedXaiModelId: null,
      selectedXaiEffort: null,
      selectedClaudeModelId: null,
      selectedClaudeEffort: null,
      selectedCodexModelId: null,
      selectedCodexEffort: null,
      transcriptionLanguage: null,
      summaryLanguage: null,
      selectedMicrophoneDeviceId: null,
      recordMicrophoneKind: null,
      recordMicrophoneDeviceId: null,
      recordOutputKind: null,
      recordAppExePath: null,
      recordAppName: null,
      liveTranscriptionEnabled: true,
      speakerDiarizationEnabled: false,
      typeSafeEnabled: true,
      calendarNotificationsEnabled: true,
      meetingPopupEnabled: true,
      disabledCalendarIds: [],
      uiLanguage: null,
      navigationPaneLength: null,
      liveCopilotPillX: null,
      liveCopilotPillY: null,
      liveCopilotPillEdge: null,
      liveCopilotPillAlong: null,
    });
  });

  it('keeps true booleans true and false booleans false when the JSON omits them', () => {
    const read = readSettings({ uiLanguage: 'es' });
    expect(read.typeSafeEnabled).toBe(true);
    expect(read.calendarNotificationsEnabled).toBe(true);
    expect(read.meetingPopupEnabled).toBe(true);
    expect(read.liveTranscriptionEnabled).toBe(true);
    expect(read.speakerDiarizationEnabled).toBe(false);
  });

  it('round-trips false for the true-default booleans', () => {
    const read = readSettings(
      parseObject(
        serializeSettings(
          applySettingsPatch(
            {},
            {
              typeSafeEnabled: false,
              calendarNotificationsEnabled: false,
              meetingPopupEnabled: false,
            },
          ),
        ),
      ),
    );
    expect(read.typeSafeEnabled).toBe(false);
    expect(read.calendarNotificationsEnabled).toBe(false);
    expect(read.meetingPopupEnabled).toBe(false);
  });
});

describe('resolvers', () => {
  it('languages default to es and keep pinned values', () => {
    expect(resolveTranscriptionLanguage(defaults)).toBe('es');
    expect(resolveSummaryLanguage(defaults)).toBe('es');
    expect(resolveTranscriptionLanguage({ ...defaults, transcriptionLanguage: 'en' })).toBe('en');
    expect(resolveSummaryLanguage({ ...defaults, summaryLanguage: ' ' })).toBe('es');
  });

  it('provider model and effort defaults', () => {
    expect(resolveClaudeModelId(defaults)).toBe('sonnet');
    expect(resolveClaudeEffort(defaults)).toBe('low');
    expect(resolveCodexModelId(defaults)).toBe('gpt-5.6');
    expect(resolveCodexEffort(defaults)).toBe('low');
    expect(resolveClaudeModelId({ ...defaults, selectedClaudeModelId: 'opus' })).toBe('opus');
  });

  it('stored blank or whitespace values resolve to the defaults (item 46)', () => {
    for (const blankValue of ['', '  ']) {
      expect(resolveClaudeModelId({ ...defaults, selectedClaudeModelId: blankValue })).toBe(
        'sonnet',
      );
      expect(resolveClaudeEffort({ ...defaults, selectedClaudeEffort: blankValue })).toBe('low');
      expect(resolveCodexModelId({ ...defaults, selectedCodexModelId: blankValue })).toBe(
        'gpt-5.6',
      );
      expect(resolveCodexEffort({ ...defaults, selectedCodexEffort: blankValue })).toBe('low');
      expect(resolveSummaryProviderKind({ ...defaults, selectedSummaryProvider: blankValue })).toBe(
        'Local',
      );
    }
  });

  it('summary provider parses case-sensitively and defaults to Local', () => {
    const p = (value: string | null) =>
      resolveSummaryProviderKind({ ...defaults, selectedSummaryProvider: value });
    expect(p(null)).toBe('Local');
    expect(p('Codex')).toBe('Codex');
    expect(p('ClaudeCode')).toBe('ClaudeCode');
    expect(p('codex')).toBe('Local');
    expect(p('nonsense')).toBe('Local');
  });

  it('a legacy Xai provider stays Xai, is unavailable, and is never mapped to Local', () => {
    const read = { ...defaults, selectedSummaryProvider: 'Xai' };
    expect(resolveSummaryProviderKind(read)).toBe('Xai');
    expect(isProviderAvailable('Xai')).toBe(false);
    for (const kind of ['Local', 'ClaudeCode', 'Codex'] as const) {
      expect(isProviderAvailable(kind)).toBe(true);
    }
  });

  it('a legacy Xai file keeps its provider, xai fields and unknown fields through a re-save', () => {
    const text = JSON.stringify(
      {
        selectedSummaryProvider: 'Xai',
        selectedXaiModelId: 'grok-4.3',
        selectedXaiEffort: 'high',
        futureField: { a: 1 },
        summaryLanguage: 'en',
      },
      null,
      2,
    );
    const parsed = parseSettingsJson(text);
    expect(parsed.settings.selectedSummaryProvider).toBe('Xai');
    expect(parsed.settings.selectedXaiModelId).toBe('grok-4.3');
    expect(parsed.settings.selectedXaiEffort).toBe('high');
    const rewritten = serializeSettings(applySettingsPatch(parsed.raw, { summaryLanguage: 'es' }));
    expect(rewritten).toContain('"selectedSummaryProvider": "Xai"');
    expect(rewritten).toContain('"selectedXaiModelId": "grok-4.3"');
    expect(rewritten).toContain('"selectedXaiEffort": "high"');
    expect(rewritten).toContain('"futureField"');
    const unchanged = serializeSettings(applySettingsPatch(parsed.raw, {}));
    expect(JSON.parse(unchanged)).toMatchObject(JSON.parse(text) as object);
  });

  it('B18: numeric text does not parse as a provider', () => {
    for (const text of ['0', '1', '99', '-1']) {
      expect(resolveSummaryProviderKind({ ...defaults, selectedSummaryProvider: text })).toBe(
        'Local',
      );
    }
  });

  it('navigation pane length defaults to 280 and clamps to 200..480', () => {
    const w = (n: number | null) =>
      resolveNavigationPaneLength({ ...defaults, navigationPaneLength: n });
    expect(w(null)).toBe(280);
    expect(w(150)).toBe(200);
    expect(w(200)).toBe(200);
    expect(w(320)).toBe(320);
    expect(w(600)).toBe(480);
    expect(w(100)).toBe(200);
    expect(w(900)).toBe(480);
    expect(w(333)).toBe(333);
    expect(w(Number.NaN)).toBe(280);
  });

  it('pill position is null when unset and round-trips negative coordinates', () => {
    expect(defaults.liveCopilotPillX).toBeNull();
    const read = readSettings({ liveCopilotPillX: -1200, liveCopilotPillY: -30 });
    expect(read.liveCopilotPillX).toBe(-1200);
    expect(read.liveCopilotPillY).toBe(-30);
  });

  it('pill edge defaults to Right and along clamps to 0..1', () => {
    const edge = (v: string | null) => resolvePillEdge({ ...defaults, liveCopilotPillEdge: v });
    expect(edge(null)).toBe('Right');
    expect(edge('Top')).toBe('Top');
    expect(edge('bogus')).toBe('Right');
    const along = (v: number | null) => resolvePillAlong({ ...defaults, liveCopilotPillAlong: v });
    expect(along(null)).toBe(0.5);
    expect(along(-2)).toBe(0);
    expect(along(9)).toBe(1);
    expect(along(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(along(0.25)).toBe(0.25);
  });

  it('disabled calendar ids drop blanks and compare ordinally', () => {
    const set = disabledCalendarIdsAsSet({ ...defaults, disabledCalendarIds: ['a', ' ', '', 'A'] });
    expect([...set]).toEqual(['a', 'A']);
    expect(disabledCalendarIdsAsSet(defaults).size).toBe(0);
  });

  it('disabled calendar ids drop true duplicates and round-trip through a write', () => {
    const set = disabledCalendarIdsAsSet({
      ...defaults,
      disabledCalendarIds: ['a', 'a', ' ', 'b'],
    });
    expect([...set]).toEqual(['a', 'b']);
    const text = serializeSettings(applySettingsPatch({}, { disabledCalendarIds: ['x', 'y'] }));
    expect(parseSettingsJson(text).settings.disabledCalendarIds).toEqual(['x', 'y']);
  });

  it('pill dock round-trips through a write, and unset reads as Right and 0.5', () => {
    const text = serializeSettings(
      applySettingsPatch({}, { liveCopilotPillEdge: 'Top', liveCopilotPillAlong: 0.25 }),
    );
    const read = parseSettingsJson(text).settings;
    expect(resolvePillEdge(read)).toBe('Top');
    expect(resolvePillAlong(read)).toBe(0.25);
    expect(resolvePillEdge(defaults)).toBe('Right');
    expect(resolvePillAlong(defaults)).toBe(0.5);
    expect(resolvePillAlong({ ...defaults, liveCopilotPillAlong: Number.NaN })).toBe(0.5);
  });

  it('removed chat keys are ignored and a stored Codex provider still resolves to Codex', () => {
    const read = parseSettingsJson(
      '{"selectedChatProvider":"Claude","selectedLiveAnswerProvider":"Xai","selectedSummaryProvider":"Codex"}',
    ).settings;
    expect(resolveSummaryProviderKind(read)).toBe('Codex');
    expect(Object.keys(read)).not.toContain('selectedChatProvider');
  });
});

describe('reading and writing', () => {
  it('accepts numbers written as strings', () => {
    expect(readSettings({ navigationPaneLength: '300' }).navigationPaneLength).toBe(300);
  });

  it('parses case-insensitive names and ignores removed provider keys', () => {
    const read = parseSettingsJson(
      '{"UILanguage":"en","removedProviderKey":"x","summaryLanguage":"en"}',
    );
    expect(read.settings.summaryLanguage).toBe('en');
    expect(read.settings.uiLanguage).toBe('en');
  });

  it('a missing or null document is the defaults', () => {
    expect(parseSettingsJson('null').settings).toEqual(defaults);
  });

  it('B5: a corrupt file raises a typed error', () => {
    expect(() => parseSettingsJson('{oops')).toThrow(LibraryFileCorruptError);
    expect(() => parseSettingsJson('[1]')).toThrow(LibraryFileCorruptError);
    expect(() => parseSettingsJson('')).toThrow(LibraryFileCorruptError);
  });

  it('writes every property in declaration order with CRLF', () => {
    const text = serializeSettings({});
    expect(text.split('\r\n')[1]).toBe('  "selectedSummaryModelId": null,');
    expect(text).toContain('  "disabledCalendarIds": [],');
    expect(text.split('\r\n').at(-2)).toBe('  "liveCopilotPillAlong": null');
    expect(text.endsWith('\r\n}')).toBe(true);
  });

  it('B17: unknown keys survive a patch and stay after the known ones', () => {
    const merged = applySettingsPatch(
      { futureThing: { a: 1 }, uiLanguage: 'en' },
      { summaryLanguage: 'en' },
    );
    const text = serializeSettings(merged);
    expect(JSON.parse(text)).toMatchObject({
      futureThing: { a: 1 },
      uiLanguage: 'en',
      summaryLanguage: 'en',
    });
    expect(text.indexOf('futureThing')).toBeGreaterThan(text.indexOf('liveCopilotPillAlong'));
  });

  it('B17: a patch changes only the named fields', () => {
    const base = applySettingsPatch({}, { summaryLanguage: 'en', uiLanguage: 'es' });
    const next = applySettingsPatch(base, { uiLanguage: 'en' });
    expect(readSettings(next).summaryLanguage).toBe('en');
    expect(readSettings(next).uiLanguage).toBe('en');
  });
});
