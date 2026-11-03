/** Model and effort choices for the CLI and xAI providers. Spec 2.3 and 2.5. The values are CLI arguments, shown raw. */

export const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'fable'] as const;
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const CODEX_MODELS = ['gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-5.6-sol'] as const;
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export const XAI_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

export const DEFAULT_EFFORT = 'low';
export const DEFAULT_CLAUDE_MODEL = 'sonnet';
export const DEFAULT_CODEX_MODEL = 'gpt-5.6';

/**
 * The list with the stored value added when it is missing, so a hand edited file never leaves a
 * blank control (B13). The value is still used as stored.
 */
export function optionsIncluding(options: readonly string[], stored: string): readonly string[] {
  return options.includes(stored) ? options : [...options, stored];
}
