import fs from 'node:fs/promises';
import {
  USER_PROMPT_LIMIT,
  USER_PROMPTS_FILE_VERSION,
  mergeImportedPrompts,
  normalizePromptDraft,
  parseUserPrompt,
  type Logger,
  type UserPrompt,
  type UserPromptDraft,
} from '@vozella/core';
import { writeFileAtomic, type AtomicFileOps } from '../fs/atomic-write';
import { fileLocks, lockKeyFor, type KeyedMutex } from '../fs/keyed-mutex';
import { errorCode, exists } from '../library/library-layout';

export interface ChatPromptStoreOptions {
  /** `chat-prompts.json` in the app data root. */
  readonly filePath: string;
  readonly newId: () => string;
  readonly logger?: Logger;
  readonly locks?: KeyedMutex;
  /** Tests replace the file calls of the atomic write. */
  readonly ops?: AtomicFileOps;
}

export type ChatPromptSaveOutcome =
  | { readonly status: 'saved'; readonly prompt: UserPrompt }
  | { readonly status: 'limit' }
  | { readonly status: 'not-found' };

export interface ChatPromptImportResult {
  readonly added: number;
  readonly renamed: number;
  readonly skipped: number;
}

interface Loaded {
  readonly prompts: readonly UserPrompt[];
  /** The file could not be read as prompts: move it aside before the next write. */
  readonly damaged: boolean;
}

/**
 * The saved chat prompts, `{ version: 1, prompts: [...] }`. Reads never throw on a bad file: the
 * list is empty, the problem is logged, and the file is kept as `.corrupt` on the next write.
 * Every change is read-modify-write under one lock and written atomically (temp file, rename).
 */
export class JsonChatPromptStore {
  private readonly locks: KeyedMutex;

  constructor(private readonly options: ChatPromptStoreOptions) {
    this.locks = options.locks ?? fileLocks;
  }

  async list(): Promise<UserPrompt[]> {
    const { prompts } = await this.locked(() => this.read());
    return [...prompts];
  }

  async create(draft: UserPromptDraft): Promise<ChatPromptSaveOutcome> {
    const clean = this.checked(draft);
    return this.change<ChatPromptSaveOutcome>((prompts) => {
      if (prompts.length >= USER_PROMPT_LIMIT) return { next: null, result: { status: 'limit' } };
      const prompt: UserPrompt = { id: this.options.newId(), ...clean };
      return { next: [...prompts, prompt], result: { status: 'saved', prompt } };
    });
  }

  async update(id: string, draft: UserPromptDraft): Promise<ChatPromptSaveOutcome> {
    const clean = this.checked(draft);
    return this.change<ChatPromptSaveOutcome>((prompts) => {
      const at = prompts.findIndex((p) => p.id === id);
      if (at === -1) return { next: null, result: { status: 'not-found' } };
      const prompt: UserPrompt = { id, ...clean };
      const next = [...prompts];
      next[at] = prompt;
      return { next, result: { status: 'saved', prompt } };
    });
  }

  remove(id: string): Promise<boolean> {
    return this.change((prompts) => {
      const next = prompts.filter((p) => p.id !== id);
      return next.length === prompts.length
        ? { next: null, result: false }
        : { next, result: true };
    });
  }

  /** Adds already checked drafts after the saved ones (see `mergeImportedPrompts`). */
  async importMany(drafts: readonly UserPromptDraft[]): Promise<ChatPromptImportResult> {
    const clean = drafts.map((d) => this.checked(d));
    return this.change((prompts) => {
      const merged = mergeImportedPrompts(prompts, clean, this.options.newId);
      const result = { added: merged.added, renamed: merged.renamed, skipped: merged.skipped };
      return { next: merged.added > 0 ? merged.prompts : null, result };
    });
  }

  private checked(draft: UserPromptDraft): UserPromptDraft {
    const clean = normalizePromptDraft(draft);
    if (clean === null) throw new TypeError('The prompt breaks the saved prompt rules.');
    return clean;
  }

  /** `edit` answers the new list (or null for no write) and the caller's result. */
  private change<T>(
    edit: (prompts: readonly UserPrompt[]) => { next: readonly UserPrompt[] | null; result: T },
  ): Promise<T> {
    return this.locked(async () => {
      const loaded = await this.read();
      const { next, result } = edit(loaded.prompts);
      if (next !== null) {
        if (loaded.damaged) await this.moveAside();
        await writeFileAtomic(
          this.options.filePath,
          `${JSON.stringify({ version: USER_PROMPTS_FILE_VERSION, prompts: next }, null, 2)}\n`,
          this.options.ops ? { ops: this.options.ops } : {},
        );
      }
      return result;
    });
  }

  private locked<T>(work: () => Promise<T>): Promise<T> {
    return this.locks.run(lockKeyFor(this.options.filePath), work);
  }

  private async read(): Promise<Loaded> {
    let text: string;
    try {
      text = await fs.readFile(this.options.filePath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { prompts: [], damaged: false };
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      return this.damaged(error);
    }
    const entries =
      typeof raw === 'object' && raw !== null && 'prompts' in raw && Array.isArray(raw.prompts)
        ? (raw.prompts as unknown[])
        : null;
    if (entries === null) return this.damaged(new Error('no prompts list'));
    const prompts: UserPrompt[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const prompt = parseUserPrompt(entry);
      if (prompt === null || seen.has(prompt.id) || prompts.length >= USER_PROMPT_LIMIT) continue;
      seen.add(prompt.id);
      prompts.push(prompt);
    }
    const skipped = entries.length - prompts.length;
    if (skipped > 0) {
      this.options.logger?.warn('chat-prompts.json had invalid prompts; skipped', { skipped });
    }
    return { prompts, damaged: false };
  }

  private damaged(error: unknown): Loaded {
    this.options.logger?.warn('chat-prompts.json is damaged; starting with no prompts', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { prompts: [], damaged: true };
  }

  /** `chat-prompts.json.corrupt`, then `.corrupt.1`, ... Never overwrites an earlier copy. */
  private async moveAside(): Promise<void> {
    const base = `${this.options.filePath}.corrupt`;
    let target = base;
    for (let n = 1; await exists(target); n += 1) target = `${base}.${String(n)}`;
    await fs.rename(this.options.filePath, target);
    this.options.logger?.warn('damaged chat-prompts.json kept aside', { keptAs: target });
  }
}
