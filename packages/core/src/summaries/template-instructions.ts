import { instructionsFor, normalizeTemplateId } from '../settings/note-templates';

/**
 * `NoteTemplateInstructions.ResolveAsync` without the store. Built-in ids give their prompt text.
 * `auto`, blank, unknown ids and `custom` give null: the custom template is dropped (owner
 * decision 2026-11-03, may return later), so an old `custom` id on disk just means no template.
 */
export function resolveTemplateInstructions(id: string | null | undefined): string | null {
  return instructionsFor(normalizeTemplateId(id));
}

/**
 * The id to store on the record after a generate. Only a built-in template is stored; `auto`,
 * blank, `custom` and unknown ids are stored as null.
 */
export function templateIdToStore(id: string | null | undefined): string | null {
  const normalized = normalizeTemplateId(id);
  return normalized !== null && instructionsFor(normalized) !== null ? normalized : null;
}
