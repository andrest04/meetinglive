import type { ChatScopeKind } from './scope-resolver';

/** `live`: only while a take records (T2), listed before the single-meeting recipes. */
export type RecipeAvailability = 'single' | 'multiple' | 'live';

/** A built-in recipe. User recipes are not ported (owner decision 2026-11-03, may return later). */
export interface ChatRecipe {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly availability: RecipeAvailability;
}

/** Looks a localized string up by key at call time (B8): recipe names and prompts. */
export type RecipeNameLookup = (key: string) => string;

interface Entry {
  readonly id: string;
  readonly nameKey: string;
  readonly promptKey: string;
  readonly availability: RecipeAvailability;
}

const ID_BASE = '11111111-1111-4111-8111-111111111';

/** Catalog order is the list order (spec 3.7). Ids are fixed; names and prompts are stored as keys. */
const CATALOG: readonly Entry[] = [
  {
    id: `${ID_BASE}101`,
    nameKey: 'RecipeDiscussedName',
    availability: 'single',
    promptKey: 'Ui_RecipeDiscussedPrompt',
  },
  {
    id: `${ID_BASE}102`,
    nameKey: 'RecipeActionItemsName',
    availability: 'single',
    promptKey: 'Ui_RecipeActionItemsPrompt',
  },
  {
    id: `${ID_BASE}103`,
    nameKey: 'RecipeFollowUpEmailName',
    availability: 'single',
    promptKey: 'Ui_RecipeFollowUpEmailPrompt',
  },
  {
    id: `${ID_BASE}104`,
    nameKey: 'RecipeNextStepsName',
    availability: 'single',
    promptKey: 'Ui_RecipeNextStepsPrompt',
  },
  {
    id: `${ID_BASE}105`,
    nameKey: 'RecipeProjectPlanName',
    availability: 'single',
    promptKey: 'Ui_RecipeProjectPlanPrompt',
  },
  // Content recipes: for a talk, a video or a class, where the meeting recipes make no sense.
  {
    id: `${ID_BASE}106`,
    nameKey: 'Ui_RecipeKeyIdeasName',
    availability: 'single',
    promptKey: 'Ui_RecipeKeyIdeasPrompt',
  },
  {
    id: `${ID_BASE}107`,
    nameKey: 'Ui_RecipeExplainName',
    availability: 'single',
    promptKey: 'Ui_RecipeExplainPrompt',
  },
  {
    id: `${ID_BASE}108`,
    nameKey: 'Ui_RecipeQuotesName',
    availability: 'single',
    promptKey: 'Ui_RecipeQuotesPrompt',
  },
  {
    id: `${ID_BASE}109`,
    nameKey: 'Ui_RecipeStudyName',
    availability: 'single',
    promptKey: 'Ui_RecipeStudyPrompt',
  },
  {
    id: `${ID_BASE}201`,
    nameKey: 'RecipeFeatureRequestsName',
    availability: 'multiple',
    promptKey: 'Ui_RecipeFeatureRequestsPrompt',
  },
  {
    id: `${ID_BASE}202`,
    nameKey: 'RecipeRecurringThemesName',
    availability: 'multiple',
    promptKey: 'Ui_RecipeRecurringThemesPrompt',
  },
  {
    id: `${ID_BASE}203`,
    nameKey: 'RecipeWeeklyUpdateName',
    availability: 'multiple',
    promptKey: 'Ui_RecipeWeeklyUpdatePrompt',
  },
];

/**
 * Live recipes (T2): they read the session context, the rolling digest and the recent tail. They
 * lead the Live list, so they are the starter chips while recording.
 */
const LIVE_CATALOG: readonly Entry[] = [
  {
    id: `${ID_BASE}301`,
    nameKey: 'Ui_RecipeLiveCatchUpName',
    availability: 'live',
    promptKey: 'Ui_RecipeLiveCatchUpPrompt',
  },
  {
    id: `${ID_BASE}302`,
    nameKey: 'Ui_RecipeLiveSummaryName',
    availability: 'live',
    promptKey: 'Ui_RecipeLiveSummaryPrompt',
  },
  {
    id: `${ID_BASE}303`,
    nameKey: 'Ui_RecipeLiveQuestionsName',
    availability: 'live',
    promptKey: 'Ui_RecipeLiveQuestionsPrompt',
  },
  {
    id: `${ID_BASE}304`,
    nameKey: 'Ui_RecipeLiveDecisionsName',
    availability: 'live',
    promptKey: 'Ui_RecipeLiveDecisionsPrompt',
  },
];

const BUILT_IN_IDS: ReadonlySet<string> = new Set([...CATALOG, ...LIVE_CATALOG].map((e) => e.id));

const toRecipe =
  (t: RecipeNameLookup) =>
  (e: Entry): ChatRecipe => ({
    id: e.id,
    name: t(e.nameKey),
    prompt: t(e.promptKey),
    availability: e.availability,
  });

export const isBuiltInRecipe = (id: string): boolean => BUILT_IN_IDS.has(id);

/** B8: names and prompts are resolved on every call, so a language change shows up on the next read. */
export function builtInRecipes(t: RecipeNameLookup): ChatRecipe[] {
  return CATALOG.map(toRecipe(t));
}

/** The live recipes, named in the current language (B8). */
export function liveRecipes(t: RecipeNameLookup): ChatRecipe[] {
  return LIVE_CATALOG.map(toRecipe(t));
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

/** What the renderer knows about the scoped content; unknown keeps the meeting order. */
export interface RecipeContext {
  /** The scoped meeting has at least one action item. */
  readonly hasActionItems?: boolean;
}

/**
 * Single-meeting list order when the content is a talk, a video or a class: the content recipes
 * lead and "What's been discussed" closes the starters; the meeting recipes follow.
 */
const CONTENT_FIRST_ORDER: readonly string[] = ['106', '107', '108', '101', '109'].map(
  (n) => `${ID_BASE}${n}`,
);

/** A meeting scope without action items reads as content, not as a meeting. */
export const prefersContentRecipes = (kind: ChatScopeKind, context: RecipeContext): boolean =>
  kind === 'Meeting' && context.hasActionItems === false;

const rank = (id: string): number => {
  const at = CONTENT_FIRST_ORDER.indexOf(id);
  return at === -1 ? CONTENT_FIRST_ORDER.length : at;
};

/**
 * Built-ins whose availability matches the scope. Catalog order (meeting recipes first), except a
 * meeting without action items, which puts the content recipes first, and Live, which puts the
 * live recipes first. The sort is stable, so the remaining recipes keep catalog order.
 */
export function recipesForScope(
  kind: ChatScopeKind,
  t: RecipeNameLookup,
  context: RecipeContext = {},
): ChatRecipe[] {
  const wanted = availabilityFor(kind);
  const list = builtInRecipes(t).filter((r) => r.availability === wanted);
  if (kind === 'Live') return [...liveRecipes(t), ...list];
  return prefersContentRecipes(kind, context) ? list.sort((a, b) => rank(a.id) - rank(b.id)) : list;
}

export const STARTER_COUNT = 4;

/** The chips above the composer: the first four recipes of the scope list. */
export const starterRecipes = (
  kind: ChatScopeKind,
  t: RecipeNameLookup,
  context: RecipeContext = {},
): ChatRecipe[] => recipesForScope(kind, t, context).slice(0, STARTER_COUNT);

/** Slash filter: case-insensitive substring of `draft.slice(1).trim()` in name or prompt; empty keeps all. */
export function filterRecipes(list: readonly ChatRecipe[], draft: string): ChatRecipe[] {
  const query = draft.slice(1).trim().toLowerCase();
  if (query === '') return [...list];
  return list.filter(
    (r) => r.name.toLowerCase().includes(query) || r.prompt.toLowerCase().includes(query),
  );
}
