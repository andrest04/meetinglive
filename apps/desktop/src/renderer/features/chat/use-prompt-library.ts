import {
  scopeRecipes,
  scopeStarters,
  type ChatRecipe,
  type ChatScopeKind,
  type RecipeContext,
  type RecipeNameLookup,
} from '@vozella/core';
import { useCallback, useMemo, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import {
  availabilityForScope,
  exportMessage,
  importMessage,
  valuesFromMessage,
} from './chat-prompts-view';
import type { PromptEditorRequest } from './PromptDialog';
import type { RecipeMenuActions } from './RecipesMenu';
import { useSavedPrompts, type SavedPrompts } from './use-saved-prompts';

export interface PromptLibraryInput {
  readonly kind: ChatScopeKind;
  /** Null while a meeting scope is read: no chips yet, so they never flip. */
  readonly context: RecipeContext | null;
  /** The composer draft: "New prompt…" starts from the question typed so far. */
  readonly draft: string;
  readonly lookup: RecipeNameLookup;
}

export interface PromptLibrary {
  /** The `/` list: saved prompts of the scope, then the built-ins. */
  readonly recipes: readonly ChatRecipe[];
  /** The chips: up to two saved prompts, then built-ins until four. */
  readonly starters: readonly ChatRecipe[];
  readonly actions: RecipeMenuActions;
  /** The picked saved prompt whose engine answers the next send; null for the default. */
  readonly armed: ChatRecipe | null;
  readonly arm: (recipe: ChatRecipe) => void;
  readonly disarm: () => void;
  readonly saveFromMessage: (text: string) => void;
  readonly editor: PromptEditorRequest | null;
  readonly closeEditor: () => void;
  readonly deleting: ChatRecipe | null;
  readonly closeDelete: () => void;
  readonly confirmDelete: () => void;
  readonly save: SavedPrompts['save'];
  /** One line after an import, an export or a failed delete. */
  readonly notice: string | null;
  readonly dismissNotice: () => void;
}

/**
 * Saved prompts as the chat panel uses them (Phase 5): the merged lists, the armed engine, and
 * the state of the editor, the delete question and the import and export line.
 */
export function usePromptLibrary({
  kind,
  context,
  draft,
  lookup,
}: PromptLibraryInput): PromptLibrary {
  const t = useT();
  const saved = useSavedPrompts();
  const { prompts, save, remove, exportAll, importFile } = saved;
  const [armed, setArmed] = useState<ChatRecipe | null>(null);
  const [editor, setEditor] = useState<PromptEditorRequest | null>(null);
  const [deleting, setDeleting] = useState<ChatRecipe | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const recipes = useMemo(
    () => scopeRecipes(kind, lookup, prompts, context ?? {}),
    [kind, lookup, prompts, context],
  );
  const starters = useMemo(
    () => (context === null ? [] : scopeStarters(kind, lookup, prompts, context)),
    [kind, lookup, prompts, context],
  );

  const actions = useMemo<RecipeMenuActions>(
    () => ({
      onNew: () => {
        // A question typed so far becomes the prompt; a slash query does not.
        const typed = draft.startsWith('/') ? '' : draft.trim();
        setEditor({
          initial: {
            name: '',
            prompt: typed,
            availability: availabilityForScope(kind),
            engine: null,
          },
        });
      },
      onEdit: (recipe) => {
        const found = prompts.find((p) => p.id === recipe.id);
        if (!found) return;
        const { id, name, prompt, availability, engine } = found;
        setEditor({ id, initial: { name, prompt, availability, engine } });
      },
      onDelete: setDeleting,
      onImport: () => {
        void importFile().then((outcome) => {
          setNotice(importMessage(outcome, t));
        });
      },
      onExport: () => {
        void exportAll().then((outcome) => {
          setNotice(exportMessage(outcome, t));
        });
      },
      canExport: prompts.length > 0,
    }),
    [draft, kind, prompts, importFile, exportAll, t],
  );

  const arm = useCallback((recipe: ChatRecipe) => {
    setArmed(recipe.engine ? recipe : null);
  }, []);
  const disarm = useCallback(() => {
    setArmed(null);
  }, []);
  const saveFromMessage = useCallback(
    (text: string) => {
      setEditor({ initial: valuesFromMessage(text, kind) });
    },
    [kind],
  );
  const confirmDelete = useCallback(() => {
    if (deleting === null) return;
    const { id } = deleting;
    setDeleting(null);
    void remove(id).then((ok) => {
      if (!ok) setNotice(t('Ui_ChatPromptDeleteFailed'));
    });
  }, [deleting, remove, t]);

  return {
    recipes,
    starters,
    actions,
    armed,
    arm,
    disarm,
    saveFromMessage,
    editor,
    closeEditor: useCallback(() => {
      setEditor(null);
    }, []),
    deleting,
    closeDelete: useCallback(() => {
      setDeleting(null);
    }, []),
    confirmDelete,
    save,
    notice,
    dismissNotice: useCallback(() => {
      setNotice(null);
    }, []),
  };
}
