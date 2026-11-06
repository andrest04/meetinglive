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
  // Content recipes: for a talk, a video or a class, where the meeting recipes make no sense.
  {
    id: `${ID_BASE}106`,
    nameKey: 'Ui_RecipeKeyIdeasName',
    availability: 'single',
    prompt:
      'List the main ideas of this recording in order. For each one, give its time range and one or two sentences. Use only what is in the recording. Answer in the language of the recording.',
  },
  {
    id: `${ID_BASE}107`,
    nameKey: 'Ui_RecipeExplainName',
    availability: 'single',
    prompt:
      'Find the hardest concepts in this recording and explain each one simply, with a concrete example. Stay faithful to what was said and mark any example of your own. Answer in the language of the recording.',
  },
  {
    id: `${ID_BASE}108`,
    nameKey: 'Ui_RecipeQuotesName',
    availability: 'single',
    prompt:
      'Quote the most notable lines of this recording word for word, each with its timestamp and the speaker when known. Do not paraphrase or invent quotes. Answer in the language of the recording.',
  },
  {
    id: `${ID_BASE}109`,
    nameKey: 'Ui_RecipeStudyName',
    availability: 'single',
    prompt:
      'Write 5 review questions about this recording, each followed by its answer taken from the content. Answer in the language of the recording.',
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
 * meeting without action items, which puts the content recipes first. The sort is stable, so the
 * remaining recipes keep catalog order.
 */
export function recipesForScope(
  kind: ChatScopeKind,
  t: RecipeNameLookup,
  context: RecipeContext = {},
): ChatRecipe[] {
  const wanted = availabilityFor(kind);
  const list = builtInRecipes(t).filter((r) => r.availability === wanted);
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
