import type {
  ChatEngineDto,
  ChatPromptsExportOutcomeDto,
  ChatPromptsImportOutcomeDto,
} from '@vozella/contracts';
import { USER_PROMPT_LIMIT, USER_PROMPT_NAME_MAX, type ChatScopeKind } from '@vozella/core';
import type { StringKey, Translate } from '../../i18n/translate';

/** What the create and edit dialog holds. `engine` null is the engine chosen in Settings. */
export interface PromptFormValues {
  readonly name: string;
  readonly prompt: string;
  readonly availability: 'single' | 'multiple';
  readonly engine: ChatEngineDto | null;
}

export const ENGINE_LABEL: Readonly<Record<ChatEngineDto, StringKey>> = {
  'claude-code': 'Ui_ChatPromptEngineClaude',
  codex: 'Ui_ChatPromptEngineCodex',
  local: 'Ui_ChatPromptEngineLocal',
};

/** A meeting (or Live) gets one-meeting prompts; a folder or all meetings get several. */
export const availabilityForScope = (kind: ChatScopeKind): 'single' | 'multiple' =>
  kind === 'Meeting' || kind === 'Live' ? 'single' : 'multiple';

/** A short name from a prompt: its first line, cut at a word to fit the name limit. */
export function promptNameFrom(text: string): string {
  const line =
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '') ?? '';
  if (line.length <= USER_PROMPT_NAME_MAX) return line;
  const cut = line.slice(0, USER_PROMPT_NAME_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > USER_PROMPT_NAME_MAX / 2 ? cut.slice(0, space) : cut).trimEnd();
}

/** "Save as prompt" on a sent message: the message is the prompt, its first line the name. */
export const valuesFromMessage = (text: string, kind: ChatScopeKind): PromptFormValues => ({
  name: promptNameFrom(text),
  prompt: text.trim(),
  availability: availabilityForScope(kind),
  engine: null,
});

/** The line the panel shows after an import; null for a cancelled dialog. */
export function importMessage(outcome: ChatPromptsImportOutcomeDto, t: Translate): string | null {
  switch (outcome.status) {
    case 'cancelled':
      return null;
    case 'invalid':
      return t('Ui_ChatPromptsImportInvalid');
    case 'failed':
      return t('Ui_ChatPromptsImportFailed');
    case 'imported': {
      const parts: string[] = [];
      if (outcome.added === 0 && outcome.skipped === 0) parts.push(t('Ui_ChatPromptsImportNone'));
      if (outcome.added === 1) parts.push(t('Ui_ChatPromptsImportedOne'));
      if (outcome.added > 1) parts.push(t('Ui_ChatPromptsImported', outcome.added));
      if (outcome.renamed > 0) parts.push(t('Ui_ChatPromptsImportRenamed', outcome.renamed));
      if (outcome.skipped > 0) {
        parts.push(t('Ui_ChatPromptsImportSkipped', outcome.skipped, USER_PROMPT_LIMIT));
      }
      return parts.join(' ');
    }
  }
}

export function exportMessage(outcome: ChatPromptsExportOutcomeDto, t: Translate): string | null {
  switch (outcome.status) {
    case 'cancelled':
      return null;
    case 'failed':
      return t('Ui_ChatPromptsExportFailed');
    case 'exported':
      return outcome.count === 1
        ? t('Ui_ChatPromptsExportedOne')
        : t('Ui_ChatPromptsExported', outcome.count);
  }
}
