import { escapeLikeDotNet, stripBom } from './dotnet-json';
import { LibraryFileCorruptError } from './errors';

/** Spec 3.17 / 4.3. JSON names are these names. This module owns the file; others own the meaning. */
export interface AppSettings {
  readonly selectedSummaryModelId: string | null;
  readonly selectedSummaryProvider: string | null;
  readonly selectedXaiModelId: string | null;
  readonly selectedXaiEffort: string | null;
  readonly selectedClaudeModelId: string | null;
  readonly selectedClaudeEffort: string | null;
  readonly selectedCodexModelId: string | null;
  readonly selectedCodexEffort: string | null;
  readonly transcriptionLanguage: string | null;
  readonly summaryLanguage: string | null;
  readonly selectedMicrophoneDeviceId: string | null;
  readonly recordMicrophoneKind: string | null;
  readonly recordMicrophoneDeviceId: string | null;
  readonly recordOutputKind: string | null;
  readonly recordAppExePath: string | null;
  readonly recordAppName: string | null;
  readonly liveTranscriptionEnabled: boolean;
  readonly speakerDiarizationEnabled: boolean;
  readonly typeSafeEnabled: boolean;
  readonly calendarNotificationsEnabled: boolean;
  readonly meetingPopupEnabled: boolean;
  readonly disabledCalendarIds: readonly string[];
  readonly uiLanguage: string | null;
  readonly navigationPaneLength: number | null;
  readonly liveCopilotPillX: number | null;
  readonly liveCopilotPillY: number | null;
  readonly liveCopilotPillEdge: string | null;
  readonly liveCopilotPillAlong: number | null;
}

type Kind = 'string' | 'bool-true' | 'bool-false' | 'strings' | 'number';

/** Declaration order is the order in the file. */
const FIELDS: readonly (readonly [keyof AppSettings, Kind])[] = [
  ['selectedSummaryModelId', 'string'],
  ['selectedSummaryProvider', 'string'],
  ['selectedXaiModelId', 'string'],
  ['selectedXaiEffort', 'string'],
  ['selectedClaudeModelId', 'string'],
  ['selectedClaudeEffort', 'string'],
  ['selectedCodexModelId', 'string'],
  ['selectedCodexEffort', 'string'],
  ['transcriptionLanguage', 'string'],
  ['summaryLanguage', 'string'],
  ['selectedMicrophoneDeviceId', 'string'],
  ['recordMicrophoneKind', 'string'],
  ['recordMicrophoneDeviceId', 'string'],
  ['recordOutputKind', 'string'],
  ['recordAppExePath', 'string'],
  ['recordAppName', 'string'],
  ['liveTranscriptionEnabled', 'bool-true'],
  ['speakerDiarizationEnabled', 'bool-false'],
  ['typeSafeEnabled', 'bool-true'],
  ['calendarNotificationsEnabled', 'bool-true'],
  ['meetingPopupEnabled', 'bool-true'],
  ['disabledCalendarIds', 'strings'],
  ['uiLanguage', 'string'],
  ['navigationPaneLength', 'number'],
  ['liveCopilotPillX', 'number'],
  ['liveCopilotPillY', 'number'],
  ['liveCopilotPillEdge', 'string'],
  ['liveCopilotPillAlong', 'number'],
];

/** The raw document: every key in the file, known or not. */
export type RawSettings = Readonly<Record<string, unknown>>;

function coerce(kind: Kind, value: unknown): unknown {
  switch (kind) {
    case 'string':
      return typeof value === 'string' ? value : null;
    case 'bool-true':
      return typeof value === 'boolean' ? value : true;
    case 'bool-false':
      return typeof value === 'boolean' ? value : false;
    case 'strings':
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    case 'number': {
      // .NET Web defaults also read numbers written as strings.
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      return typeof n === 'number' && Number.isFinite(n) ? n : null;
    }
  }
}

/** Typed settings from a raw document. Missing or wrong-typed fields take their defaults. */
export function readSettings(raw: RawSettings): AppSettings {
  const lowered = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  const out: Record<string, unknown> = {};
  for (const [key, kind] of FIELDS) out[key] = coerce(kind, lowered.get(key.toLowerCase()));
  return out as unknown as AppSettings;
}

export interface ParsedSettings {
  readonly settings: AppSettings;
  readonly raw: RawSettings;
}

/** Parses `settings.json`. Damage raises LibraryFileCorruptError; `null` is the defaults. */
export function parseSettingsJson(text: string): ParsedSettings {
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch (error) {
    throw new LibraryFileCorruptError(
      'settings',
      error instanceof Error ? error.message : 'invalid JSON',
    );
  }
  if (value === null) return { settings: readSettings({}), raw: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LibraryFileCorruptError('settings', 'expected a JSON object');
  }
  const raw = value as RawSettings;
  return { settings: readSettings(raw), raw };
}

/**
 * Returns a new raw document with the patched fields replaced. Keys this version does not
 * know are kept (B17), so a newer file survives an older writer.
 */
export function applySettingsPatch(raw: RawSettings, patch: Partial<AppSettings>): RawSettings {
  const known = new Set(FIELDS.map(([key]) => key.toLowerCase()));
  const replaced = new Set(
    Object.keys(patch)
      .filter(
        (key) => known.has(key.toLowerCase()) && patch[key as keyof AppSettings] !== undefined,
      )
      .map((key) => key.toLowerCase()),
  );
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!replaced.has(key.toLowerCase())) next[key] = value;
  }
  for (const [key, value] of Object.entries(patch)) {
    if ((value as unknown) !== undefined && known.has(key.toLowerCase())) next[key] = value;
  }
  return next;
}

/** Writes every known property in order (nulls included), then any unknown keys. CRLF like .NET. */
export function serializeSettings(raw: RawSettings, newline: '\r\n' | '\n' = '\r\n'): string {
  const settings = readSettings(raw);
  const known = new Set(FIELDS.map(([key]) => key.toLowerCase()));
  const doc: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(raw)) {
    if (!known.has(key.toLowerCase())) doc[key] = value;
  }
  const text = escapeLikeDotNet(JSON.stringify(doc, null, 2));
  return newline === '\n' ? text : text.replace(/\n/g, newline);
}

// ---------------------------------------------------------------- resolvers

const blank = (value: string | null): boolean => value === null || value.trim() === '';

export const SUMMARY_PROVIDERS = ['Local', 'ClaudeCode', 'Codex', 'Xai'] as const;
export type SummaryProviderKind = (typeof SUMMARY_PROVIDERS)[number];
export const PILL_EDGES = ['Left', 'Right', 'Top', 'Bottom'] as const;
export type PillEdge = (typeof PILL_EDGES)[number];

export const resolveTranscriptionLanguage = (s: AppSettings): string =>
  blank(s.transcriptionLanguage) ? 'es' : (s.transcriptionLanguage ?? 'es');
export const resolveSummaryLanguage = (s: AppSettings): string =>
  blank(s.summaryLanguage) ? 'es' : (s.summaryLanguage ?? 'es');
export const resolveClaudeModelId = (s: AppSettings): string =>
  blank(s.selectedClaudeModelId) ? 'sonnet' : (s.selectedClaudeModelId ?? 'sonnet');
export const resolveClaudeEffort = (s: AppSettings): string =>
  blank(s.selectedClaudeEffort) ? 'low' : (s.selectedClaudeEffort ?? 'low');
export const resolveCodexModelId = (s: AppSettings): string =>
  blank(s.selectedCodexModelId) ? 'gpt-5.6' : (s.selectedCodexModelId ?? 'gpt-5.6');
export const resolveCodexEffort = (s: AppSettings): string =>
  blank(s.selectedCodexEffort) ? 'low' : (s.selectedCodexEffort ?? 'low');
export const resolveXaiEffort = (s: AppSettings): string =>
  blank(s.selectedXaiEffort) ? 'low' : (s.selectedXaiEffort ?? 'low');

/** Case-sensitive name match only; numeric text no longer maps to an undefined value (B18). */
export function resolveSummaryProviderKind(s: AppSettings): SummaryProviderKind {
  return SUMMARY_PROVIDERS.find((kind) => kind === s.selectedSummaryProvider) ?? 'Local';
}

export function resolveNavigationPaneLength(s: AppSettings): number {
  const value = s.navigationPaneLength;
  if (value === null || !Number.isFinite(value)) return 280;
  return Math.min(480, Math.max(200, value));
}

export function resolvePillEdge(s: AppSettings): PillEdge {
  return PILL_EDGES.find((edge) => edge === s.liveCopilotPillEdge) ?? 'Right';
}

export function resolvePillAlong(s: AppSettings): number {
  const value = s.liveCopilotPillAlong;
  if (value === null || !Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function disabledCalendarIdsAsSet(s: AppSettings): ReadonlySet<string> {
  return new Set(s.disabledCalendarIds.filter((id) => id.trim() !== ''));
}
