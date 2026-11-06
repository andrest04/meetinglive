import { describe, expect, it } from 'vitest';
import {
  availabilityFor,
  builtInRecipes,
  filterRecipes,
  isBuiltInRecipe,
  recipesForScope,
  starterRecipes,
} from './recipes';
import en from '../../../../apps/desktop/src/renderer/i18n/locales/en.json';
import es from '../../../../apps/desktop/src/renderer/i18n/locales/es.json';
import uiEn from '../../../../apps/desktop/src/renderer/i18n/locales/ui.en.json';
import uiEs from '../../../../apps/desktop/src/renderer/i18n/locales/ui.es.json';

// The renderer resolves both the converted WinUI keys and the hand-written `Ui_` keys.
const enT = { ...en, ...uiEn } as Record<string, string>;
const esT = { ...es, ...uiEs } as Record<string, string>;
const t = (key: string): string => enT[key] ?? `?${key}`;
const MEETING_FIRST = ['101', '102', '103', '104', '105', '106', '107', '108', '109'];
const CONTENT_FIRST = ['106', '107', '108', '101', '109', '102', '103', '104', '105'];
const suffix = (list: readonly { id: string }[]): string[] => list.map((r) => r.id.slice(-3));

describe('built-in recipe catalog', () => {
  it('BuiltIns_ListsSingleAndMultipleRecipes', () => {
    const all = builtInRecipes(t);
    expect(all.map((r) => r.name)).toEqual([
      "What's been discussed",
      'Action items',
      'Follow-up email',
      'What should I do next',
      'Project plan',
      'Key ideas',
      'Explain the hard parts',
      'Notable quotes',
      'Review questions',
      'Top feature requests',
      'Recurring themes',
      'Weekly update',
    ]);
    expect(all.map((r) => r.id)).toEqual([
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `11111111-1111-4111-8111-11111111110${n}`),
      ...[1, 2, 3].map((n) => `11111111-1111-4111-8111-11111111120${n}`),
    ]);
    expect(new Set(all.map((r) => r.id)).size).toBe(12);
    expect(all.filter((r) => r.availability === 'single')).toHaveLength(9);
    expect(all.filter((r) => r.availability === 'multiple')).toHaveLength(3);
    expect(all.map((r) => r.prompt)).toEqual([
      'Give a short recap of what has been discussed so far.',
      'Extract owners and next steps. If the owner is not in the context, say unassigned.',
      'Draft a concise follow-up email. Do not send it.',
      'List my next steps from this meeting.',
      'Draft a short project plan from this meeting: outcome, steps, owners, open questions. Do not invent owners.',
      ...all.slice(5, 9).map((r) => r.prompt),
      'Group product feedback into themes.',
      'Identify patterns across the packed meetings.',
      'Write bullets of decisions, blockers, and next steps. Draft only. Do not send it.',
    ]);
    for (const r of all.slice(5, 9)) {
      expect(r.prompt).toMatch(/^[ -~]+$/);
      expect(r.prompt).toContain('Answer in the language of the recording.');
    }
    expect(all.every((r) => isBuiltInRecipe(r.id))).toBe(true);
    expect(isBuiltInRecipe('nope')).toBe(false);
  });

  it('every recipe name key exists in en.json and es.json', () => {
    const keys = builtInRecipes((k) => k).map((r) => r.name);
    expect(keys).toHaveLength(12);
    for (const k of keys) {
      expect(enT[k]).toBeTruthy();
      expect(esT[k]).toBeTruthy();
    }
  });

  it('B8: names follow the language at call time, not at load time', () => {
    let table = enT;
    const live = (k: string): string => table[k] ?? k;
    expect(builtInRecipes(live)[1]!.name).toBe('Action items');
    table = esT;
    expect(builtInRecipes(live)[1]!.name).toBe('Tareas pendientes');
    expect(recipesForScope('Meeting', live)[0]!.name).toBe('Qué se ha hablado');
    expect(recipesForScope('Meeting', live, { hasActionItems: false })[0]!.name).toBe(
      'Ideas principales',
    );
  });

  it('content recipes have their own name keys', () => {
    const keys = builtInRecipes((k) => k)
      .slice(5, 9)
      .map((r) => r.name);
    expect(keys).toEqual([
      'Ui_RecipeKeyIdeasName',
      'Ui_RecipeExplainName',
      'Ui_RecipeQuotesName',
      'Ui_RecipeStudyName',
    ]);
    expect(keys.map((k) => esT[k])).toEqual([
      'Ideas principales',
      'Explícame lo más difícil',
      'Citas destacadas',
      'Preguntas de repaso',
    ]);
  });
});

describe('recipe scope lists', () => {
  it('AvailabilityFor_MatchesScope', () => {
    expect(availabilityFor('Meeting')).toBe('single');
    expect(availabilityFor('Live')).toBe('single');
    expect(availabilityFor('Folder')).toBe('multiple');
    expect(availabilityFor('AllMeetings')).toBe('multiple');
    expect(() => availabilityFor('Other' as never)).toThrow();
  });

  it('ForScope returns built-ins of the scope in catalog order', () => {
    expect(suffix(recipesForScope('Meeting', t))).toEqual(MEETING_FIRST);
    expect(suffix(recipesForScope('Live', t))).toEqual(MEETING_FIRST);
    expect(suffix(recipesForScope('Folder', t))).toEqual(['201', '202', '203']);
    expect(recipesForScope('AllMeetings', t)).toHaveLength(3);
  });

  it('ForScope_DoesNotMutateBuiltInInstances: each call returns fresh copies', () => {
    const a = recipesForScope('Meeting', t);
    (a[0] as { name: string }).name = 'changed';
    expect(recipesForScope('Meeting', t)[0]!.name).toBe("What's been discussed");
  });

  it('starterRecipes is the first four of the scope list', () => {
    expect(suffix(starterRecipes('Meeting', t))).toEqual(['101', '102', '103', '104']);
    expect(starterRecipes('Folder', t)).toHaveLength(3);
  });

  it('a meeting with action items keeps the meeting recipes first', () => {
    const context = { hasActionItems: true };
    expect(suffix(recipesForScope('Meeting', t, context))).toEqual(MEETING_FIRST);
    expect(suffix(starterRecipes('Meeting', t, context))).toEqual(['101', '102', '103', '104']);
  });

  it('a meeting without action items (a talk, a class) puts the content recipes first', () => {
    const context = { hasActionItems: false };
    expect(suffix(recipesForScope('Meeting', t, context))).toEqual(CONTENT_FIRST);
    expect(starterRecipes('Meeting', t, context).map((r) => r.name)).toEqual([
      'Key ideas',
      'Explain the hard parts',
      'Notable quotes',
      "What's been discussed",
    ]);
  });

  it('only a meeting scope reacts to the action items; live and multi scopes do not', () => {
    const context = { hasActionItems: false };
    expect(suffix(recipesForScope('Live', t, context))).toEqual(MEETING_FIRST);
    expect(suffix(recipesForScope('Folder', t, context))).toEqual(['201', '202', '203']);
    expect(suffix(starterRecipes('AllMeetings', t, context))).toEqual(['201', '202', '203']);
  });

  it('filterRecipes: case-insensitive substring of draft[1..] trimmed on name or prompt', () => {
    const list = recipesForScope('Meeting', t);
    expect(filterRecipes(list, '/')).toHaveLength(9);
    expect(filterRecipes(list, '/   ')).toHaveLength(9);
    expect(suffix(filterRecipes(list, '/ACTION'))).toEqual(['102']);
    expect(suffix(filterRecipes(list, '/ concise follow'))).toEqual(['103']);
    expect(filterRecipes(list, '/zzz')).toEqual([]);
  });
});
