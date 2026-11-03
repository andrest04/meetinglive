/** Note templates. Spec 2.7. The instruction texts are prompts: they are copied verbatim. */

export interface NoteTemplateOption {
  readonly id: string;
  /** Catalog key for built-ins; null for the user's own template. */
  readonly labelKey: string | null;
  /** The user's template name; null for built-ins. */
  readonly name: string | null;
}

export const NOTE_TEMPLATE_BUILT_INS: readonly {
  readonly id: string;
  readonly labelKey: string;
}[] = [
  { id: 'auto', labelKey: 'NoteTemplate_Auto' },
  { id: 'one-on-one', labelKey: 'NoteTemplate_OneOnOne' },
  { id: 'standup', labelKey: 'NoteTemplate_Standup' },
  { id: 'sales', labelKey: 'NoteTemplate_Sales' },
  { id: 'user-interview', labelKey: 'NoteTemplate_UserInterview' },
];

export const CUSTOM_TEMPLATE_ID = 'custom';

const INSTRUCTIONS: Readonly<Record<string, string>> = {
  'one-on-one':
    'Shape the enhanced notes as a 1:1. Include decisions, feedback, and commitments that were actually stated. Omit a heading if that content is not in the sources.',
  standup:
    'Shape the enhanced notes as a standup. Include yesterday, today, and blockers that were actually stated. Omit a heading if that content is not in the sources.',
  sales:
    'Shape the enhanced notes as a sales call. Include pain, decision process, next step, and objections that were actually stated. Omit a heading if that content is not in the sources.',
  'user-interview':
    'Shape the enhanced notes as a user interview. Include what they tried, quotes, and jobs-to-be-done. Quotes must be taken from the transcript or the raw notes. Do not invent quotes.',
};

/** The prompt text for a built-in template, or null for `auto`, `custom`, blank and unknown ids. */
export function instructionsFor(id: string | null | undefined): string | null {
  const key = (id ?? '').trim();
  return Object.hasOwn(INSTRUCTIONS, key) ? (INSTRUCTIONS[key] ?? null) : null;
}

/** Blank and `auto` (any case) mean no template; anything else is the trimmed id. */
export function normalizeTemplateId(id: string | null | undefined): string | null {
  const trimmed = (id ?? '').trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'auto') return null;
  return trimmed;
}

/** The picker list: the built-ins, then the user's template when it has a name. */
export function noteTemplateOptions(
  custom: { readonly name: string | null } | null,
): readonly NoteTemplateOption[] {
  const options: NoteTemplateOption[] = NOTE_TEMPLATE_BUILT_INS.map((t) => ({
    id: t.id,
    labelKey: t.labelKey,
    name: null,
  }));
  const name = custom?.name?.trim() ?? '';
  if (name !== '') options.push({ id: CUSTOM_TEMPLATE_ID, labelKey: null, name });
  return options;
}
