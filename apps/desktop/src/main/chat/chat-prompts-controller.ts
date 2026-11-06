import {
  chatPromptsChanged,
  type ChatPromptDraftDto,
  type ChatPromptDto,
  type ChatPromptSaveOutcomeDto,
  type ChatPromptsExportOutcomeDto,
  type ChatPromptsImportOutcomeDto,
} from '@vozella/contracts';
import { parsePromptsFile, serializePromptsFile, type Logger } from '@vozella/core';
import type { JsonChatPromptStore } from '@vozella/platform';
import type { Broadcast } from '../summaries/summaries-controller';

/** The slice of the prompt store the controller drives. */
export type ChatPromptsPort = Pick<
  JsonChatPromptStore,
  'list' | 'create' | 'update' | 'remove' | 'importMany'
>;

export interface ChatPromptsControllerDeps {
  readonly store: ChatPromptsPort;
  readonly broadcast: Broadcast;
  readonly logger: Logger;
  /** The system save dialog; null when the user cancels. */
  readonly pickExportPath: () => Promise<string | null>;
  /** The system open dialog; null when the user cancels. */
  readonly pickImportPath: () => Promise<string | null>;
  /** Reads a picked file. Throws for a file that is missing, unreadable or too large. */
  readonly readText: (path: string) => Promise<string>;
  readonly writeText: (path: string, text: string) => Promise<void>;
}

/**
 * Saved chat prompts for the page (Phase 5): the list, the edits, and the `.vozella-prompts.json`
 * export and import. Every answer is a value; a change goes to every window as
 * `chat.promptsChanged`.
 */
export class ChatPromptsController {
  constructor(private readonly deps: ChatPromptsControllerDeps) {}

  async list(): Promise<{ prompts: ChatPromptDto[] }> {
    try {
      return { prompts: await this.deps.store.list() };
    } catch (error) {
      this.deps.logger.error('saved prompts could not be read', { error });
      return { prompts: [] };
    }
  }

  create(draft: ChatPromptDraftDto): Promise<ChatPromptSaveOutcomeDto> {
    return this.save(() => this.deps.store.create(draft));
  }

  update(id: string, draft: ChatPromptDraftDto): Promise<ChatPromptSaveOutcomeDto> {
    return this.save(() => this.deps.store.update(id, draft));
  }

  async remove(id: string): Promise<{ status: 'deleted' | 'not-found' | 'failed' }> {
    try {
      const removed = await this.deps.store.remove(id);
      if (!removed) return { status: 'not-found' };
      await this.publish();
      return { status: 'deleted' };
    } catch (error) {
      this.deps.logger.error('saved prompt could not be deleted', { error });
      return { status: 'failed' };
    }
  }

  async exportAll(): Promise<ChatPromptsExportOutcomeDto> {
    try {
      const target = await this.deps.pickExportPath();
      if (target === null) return { status: 'cancelled' };
      const prompts = await this.deps.store.list();
      await this.deps.writeText(target, serializePromptsFile(prompts));
      return { status: 'exported', count: prompts.length };
    } catch (error) {
      this.deps.logger.error('saved prompts could not be exported', { error });
      return { status: 'failed' };
    }
  }

  async importFile(): Promise<ChatPromptsImportOutcomeDto> {
    let text: string;
    try {
      const source = await this.deps.pickImportPath();
      if (source === null) return { status: 'cancelled' };
      text = await this.deps.readText(source);
    } catch (error) {
      this.deps.logger.warn('prompts file could not be read', { error });
      return { status: 'failed' };
    }
    const parsed = parsePromptsFile(text);
    if (parsed.status === 'invalid') return { status: 'invalid' };
    try {
      const result = await this.deps.store.importMany(parsed.prompts);
      if (result.added > 0) await this.publish();
      return { status: 'imported', ...result };
    } catch (error) {
      this.deps.logger.error('saved prompts could not be imported', { error });
      return { status: 'failed' };
    }
  }

  private async save(
    write: () => Promise<
      Exclude<ChatPromptSaveOutcomeDto, { status: 'failed' }> | ChatPromptSaveOutcomeDto
    >,
  ): Promise<ChatPromptSaveOutcomeDto> {
    try {
      const outcome = await write();
      if (outcome.status === 'saved') await this.publish();
      return outcome;
    } catch (error) {
      this.deps.logger.error('saved prompt could not be written', { error });
      return { status: 'failed' };
    }
  }

  private async publish(): Promise<void> {
    this.deps.broadcast(chatPromptsChanged, { prompts: await this.deps.store.list() });
  }
}
