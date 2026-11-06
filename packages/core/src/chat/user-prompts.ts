import {
  STARTER_COUNT,
  availabilityFor,
  recipesForScope,
  type ChatRecipe,
  type RecipeContext,
  type RecipeNameLookup,
} from './recipes';
import type { ChatScopeKind } from './scope-resolver';

/**
 * Saved prompts: the user's own recipes (Phase 5 of the AI panel). They live in
 * `chat-prompts.json` next to the settings, are listed before the built-ins, and can name the
 * engine that answers them. Pure rules only; the file and the dialogs live in platform and main.
 */

export const CHAT_ENGINES = ['claude-code', 'codex', 'local'] as const;
/** An engine a saved prompt can ask for. Null on a prompt means the engine chosen in Settings. */
export type ChatEngine = (typeof CHAT_ENGINES)[number];

export const USER_PROMPT_NAME_MAX = 60;
export const USER_PROMPT_TEXT_MAX = 4_000;
/** At most this many saved prompts. */
export const USER_PROMPT_LIMIT = 100;
export const USER_PROMPTS_FILE_VERSION = 1;
/** Saved prompts that lead the starter chips; built-ins fill the rest. */
export const USER_STARTER_COUNT = 2;
/** An import larger than this is not a prompts file. */
const FILE_TEXT_MAX = 2_000_000;
const ID_MAX = 100;

export type UserPromptAvailability = 'single' | 'multiple';

export interface UserPromptDraft {
  readonly name: string;
  readonly prompt: string;
  readonly availability: UserPromptAvailability;
  readonly engine: ChatEngine | null;
}

export interface UserPrompt extends UserPromptDraft {
  readonly id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isEngine = (value: unknown): value is ChatEngine =>
  typeof value === 'string' && (CHAT_ENGINES as readonly string[]).includes(value);

const trimmed = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' || text.length > max ? null : text;
};

/** A draft from any source (the page, the file, an import), trimmed; null when it breaks a rule. */
export function normalizePromptDraft(raw: unknown): UserPromptDraft | null {
  if (!isRecord(raw)) return null;
  const name = trimmed(raw.name, USER_PROMPT_NAME_MAX);
  const prompt = trimmed(raw.prompt, USER_PROMPT_TEXT_MAX);
  const { availability } = raw;
  if (name === null || prompt === null) return null;
  if (availability !== 'single' && availability !== 'multiple') return null;
  const engine = raw.engine ?? null;
  if (engine !== null && !isEngine(engine)) return null;
  return { name, prompt, availability, engine };
}

/** A stored prompt: a valid draft plus its id. */
export function parseUserPrompt(raw: unknown): UserPrompt | null {
  if (!isRecord(raw)) return null;
  const { id } = raw;
  if (typeof id !== 'string' || id === '' || id.length > ID_MAX) return null;
  const draft = normalizePromptDraft(raw);
  return draft === null ? null : { id, ...draft };
}

export type PromptsFileParse =
  | { readonly status: 'ok'; readonly prompts: readonly UserPromptDraft[] }
  | { readonly status: 'invalid' };

const draftOnly = (p: UserPromptDraft): UserPromptDraft => ({
  name: p.name,
  prompt: p.prompt,
  availability: p.availability,
  engine: p.engine,
});

/** `.vozella-prompts.json`: `{ version: 1, prompts: [...] }`. Ids stay on this computer. */
export function serializePromptsFile(prompts: readonly UserPromptDraft[]): string {
  return `${JSON.stringify(
    { version: USER_PROMPTS_FILE_VERSION, prompts: prompts.map(draftOnly) },
    null,
    2,
  )}\n`;
}

/** An import is all or nothing: one bad entry refuses the whole file, so nothing half-arrives. */
export function parsePromptsFile(text: string): PromptsFileParse {
  const invalid = { status: 'invalid' } as const;
  if (text.length > FILE_TEXT_MAX) return invalid;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return invalid;
  }
  if (!isRecord(raw) || raw.version !== USER_PROMPTS_FILE_VERSION) return invalid;
  if (!Array.isArray(raw.prompts)) return invalid;
  const prompts: UserPromptDraft[] = [];
  for (const entry of raw.prompts as unknown[]) {
    const draft = normalizePromptDraft(entry);
    if (draft === null) return invalid;
    prompts.push(draft);
  }
  return { status: 'ok', prompts };
}

/** `Name`, then `Name (2)`, `Name (3)`... compared without case, cut to fit the name limit. */
export function uniquePromptName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${String(n)})`;
    const base = name.slice(0, USER_PROMPT_NAME_MAX - suffix.length).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

export interface ImportMerge {
  readonly prompts: readonly UserPrompt[];
  readonly added: number;
  /** Added under another name because the name was taken. */
  readonly renamed: number;
  /** Left out because the limit was reached. */
  readonly skipped: number;
}

/** Imported prompts go after the saved ones with new ids; a taken name gets a number. */
export function mergeImportedPrompts(
  existing: readonly UserPrompt[],
  incoming: readonly UserPromptDraft[],
  newId: () => string,
): ImportMerge {
  const prompts = [...existing];
  const taken = existing.map((p) => p.name);
  let added = 0;
  let renamed = 0;
  let skipped = 0;
  for (const draft of incoming) {
    if (prompts.length >= USER_PROMPT_LIMIT) {
      skipped += 1;
      continue;
    }
    const name = uniquePromptName(draft.name, taken);
    if (name !== draft.name) renamed += 1;
    taken.push(name);
    prompts.push({ ...draftOnly(draft), name, id: newId() });
    added += 1;
  }
  return { prompts, added, renamed, skipped };
}

/** A saved prompt as a row of the recipe list. */
export const userPromptRecipe = (p: UserPrompt): ChatRecipe => ({
  id: p.id,
  name: p.name,
  prompt: p.prompt,
  availability: p.availability,
  owner: 'user',
  engine: p.engine,
});

const userRecipesFor = (kind: ChatScopeKind, prompts: readonly UserPrompt[]): ChatRecipe[] => {
  const wanted = availabilityFor(kind);
  return prompts.filter((p) => p.availability === wanted).map(userPromptRecipe);
};

/**
 * The `/` list: saved prompts of the scope first (Notion lists custom skills first), then the
 * built-ins in their own order. Live takes the single-meeting prompts.
 */
export function scopeRecipes(
  kind: ChatScopeKind,
  t: RecipeNameLookup,
  prompts: readonly UserPrompt[],
  context: RecipeContext = {},
): ChatRecipe[] {
  return [...userRecipesFor(kind, prompts), ...recipesForScope(kind, t, context)];
}

/** The chips: up to two saved prompts, then built-ins until there are four. */
export function scopeStarters(
  kind: ChatScopeKind,
  t: RecipeNameLookup,
  prompts: readonly UserPrompt[],
  context: RecipeContext = {},
): ChatRecipe[] {
  const mine = userRecipesFor(kind, prompts).slice(0, USER_STARTER_COUNT);
  const builtIns = recipesForScope(kind, t, context).slice(0, STARTER_COUNT - mine.length);
  return [...mine, ...builtIns];
}
