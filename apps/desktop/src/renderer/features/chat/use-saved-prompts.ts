import type {
  ChatPromptDto,
  ChatPromptSaveOutcomeDto,
  ChatPromptsExportOutcomeDto,
  ChatPromptsImportOutcomeDto,
} from '@vozella/contracts';
import { useCallback, useEffect, useState } from 'react';
import type { PromptFormValues } from './chat-prompts-view';

export interface SavedPrompts {
  /** The saved prompts, in saved order; empty until main answers. */
  readonly prompts: readonly ChatPromptDto[];
  /** Creates (no id) or updates a prompt. Never throws: a broken call answers `failed`. */
  readonly save: (values: PromptFormValues, id?: string) => Promise<ChatPromptSaveOutcomeDto>;
  readonly remove: (id: string) => Promise<boolean>;
  readonly exportAll: () => Promise<ChatPromptsExportOutcomeDto>;
  readonly importFile: () => Promise<ChatPromptsImportOutcomeDto>;
}

/**
 * The saved prompts as main holds them (`chat-prompts.json`). The list follows
 * `chat.promptsChanged`, so an edit in one window shows in every panel.
 */
export function useSavedPrompts(): SavedPrompts {
  const [prompts, setPrompts] = useState<readonly ChatPromptDto[]>([]);

  useEffect(() => {
    let alive = true;
    void window.vozella
      .invoke('chat.prompts.list', {})
      .then(({ prompts: list }) => {
        if (alive) setPrompts(list);
      })
      .catch(() => undefined);
    const off = window.vozella.on('chat.promptsChanged', ({ prompts: list }) => {
      setPrompts(list);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const save = useCallback(
    async (values: PromptFormValues, id?: string): Promise<ChatPromptSaveOutcomeDto> => {
      try {
        return id === undefined
          ? await window.vozella.invoke('chat.prompts.create', { draft: values })
          : await window.vozella.invoke('chat.prompts.update', { id, draft: values });
      } catch {
        return { status: 'failed' };
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { status } = await window.vozella.invoke('chat.prompts.delete', { id });
      return status !== 'failed';
    } catch {
      return false;
    }
  }, []);

  const exportAll = useCallback(async (): Promise<ChatPromptsExportOutcomeDto> => {
    try {
      return await window.vozella.invoke('chat.prompts.export', {});
    } catch {
      return { status: 'failed' };
    }
  }, []);

  const importFile = useCallback(async (): Promise<ChatPromptsImportOutcomeDto> => {
    try {
      return await window.vozella.invoke('chat.prompts.import', {});
    } catch {
      return { status: 'failed' };
    }
  }, []);

  return { prompts, save, remove, exportAll, importFile };
}
