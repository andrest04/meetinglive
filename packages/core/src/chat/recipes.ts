import type { ChatScopeKind } from './scope-resolver';

export type RecipeAvailability = 'single' | 'multiple';

/** A built-in recipe. User recipes are not ported (owner decision 2026-11-03, may return later). */
export interface ChatRecipe {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly availability: RecipeAvailability;
}

/** Looks a localized string up by key at call time (B8). */
export type RecipeNameLookup = (key: string) => string;

interface Entry {
  readonly id: string;
  readonly nameKey: string;
  readonly prompt: string;
  readonly availability: RecipeAvailability;
}

const ID_BASE = '11111111-1111-4111-8111-111111111';

/** Catalog order is the list order (spec 3.7). Ids and prompts are fixed; only the name key is stored. */
const CATALOG: readonly Entry[] = [
  {
    id: `${ID_BASE}101`,
    nameKey: 'RecipeDiscussedName',
    availability: 'single',
    prompt: 'Give a short recap of what has been discussed so far.',
  },
  {
    id: `${ID_BASE}102`,
    nameKey: 'RecipeActionItemsName',
    availability: 'single',
    prompt: 'Extract owners and next steps. If the owner is not in the context, say unassigned.',
  },
  {
    id: `${ID_BASE}103`,
    nameKey: 'RecipeFollowUpEmailName',
    availability: 'single',
    prompt: 'Draft a concise follow-up email. Do not send it.',
  },
  {
    id: `${ID_BASE}104`,
    nameKey: 'RecipeNextStepsName',
    availability: 'single',
    prompt: 'List my next steps from this meeting.',
  },
  {
    id: `${ID_BASE}105`,
    nameKey: 'RecipeProjectPlanName',
    availability: 'single',
    prompt:
      'Draft a short project plan from this meeting: outcome, steps, owners, open questions. Do not invent owners.',
  },
  {
    id: `${ID_BASE}201`,
    nameKey: 'RecipeFeatureRequestsName',
    availability: 'multiple',
    prompt: 'Group product feedback into themes.',
  },
  {
    id: `${ID_BASE}202`,
    nameKey: 'RecipeRecurringThemesName',
    availability: 'multiple',
    prompt: 'Identify patterns across the packed meetings.',
  },
  {
    id: `${ID_BASE}203`,
    nameKey: 'RecipeWeeklyUpdateName',
    availability: 'multiple',
    prompt: 'Write bullets of decisions, blockers, and next steps. Draft only. Do not send it.',
  },
];

const BUILT_IN_IDS: ReadonlySet<string> = new Set(CATALOG.map((e) => e.id));

export const isBuiltInRecipe = (id: string): boolean => BUILT_IN_IDS.has(id);

/** B8: names are resolved on every call, so a language change shows up on the next read. */
export function builtInRecipes(t: RecipeNameLookup): ChatRecipe[] {
  return CATALOG.map((e) => ({
    id: e.id,
    name: t(e.nameKey),
    prompt: e.prompt,
    availability: e.availability,
  }));
}

export function availabilityFor(kind: ChatScopeKind): RecipeAvailability {
  switch (kind) {
    case 'Meeting':
    case 'Live':
      return 'single';
    case 'Folder':
    case 'AllMeetings':
      return 'multiple';
    default:
      throw new RangeError(`Unknown chat scope: ${String(kind)}`);
  }
}

/** Built-ins whose availability matches the scope, in catalog order. */
export function recipesForScope(kind: ChatScopeKind, t: RecipeNameLookup): ChatRecipe[] {
  const wanted = availabilityFor(kind);
  return builtInRecipes(t).filter((r) => r.availability === wanted);
}

export const STARTER_COUNT = 4;

/** The chips above the composer: the first four recipes of the scope list. */
export const starterRecipes = (kind: ChatScopeKind, t: RecipeNameLookup): ChatRecipe[] =>
  recipesForScope(kind, t).slice(0, STARTER_COUNT);

/** Slash filter: case-insensitive substring of `draft.slice(1).trim()` in name or prompt; empty keeps all. */
export function filterRecipes(list: readonly ChatRecipe[], draft: string): ChatRecipe[] {
  const query = draft.slice(1).trim().toLowerCase();
  if (query === '') return [...list];
  return list.filter(
    (r) => r.name.toLowerCase().includes(query) || r.prompt.toLowerCase().includes(query),
  );
}
