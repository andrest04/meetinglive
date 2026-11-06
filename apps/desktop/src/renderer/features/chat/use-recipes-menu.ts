import { filterRecipes, type ChatRecipe } from '@vozella/core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';

/** Where the flyout was opened from: the button shows everything, the slash filters (item 111). */
export type RecipesOpenMode = 'button' | 'slash';

export interface UseRecipesMenuInput {
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  /** Every built-in recipe of the scope, already named in the current language (B8). */
  readonly recipes: readonly ChatRecipe[];
  readonly field: RefObject<HTMLTextAreaElement | null>;
  /** Told about every pick, after the draft is filled (a saved prompt arms its engine). */
  readonly onPicked?: (recipe: ChatRecipe) => void;
}

export interface RecipesMenuState {
  readonly isOpen: boolean;
  readonly visible: readonly ChatRecipe[];
  /** Index of the highlighted recipe, or -1 while the arrow keys have not been used yet. */
  readonly activeIndex: number;
  toggle: () => void;
  close: () => void;
  pick: (recipe: ChatRecipe) => void;
  /** Handles the keys the flyout owns. Returns true when it consumed the event. */
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
}

/**
 * Behavior of the Recipes flyout (spec 2.5). Focus never leaves the composer: arrows only move the
 * highlight after the first ArrowDown, so Enter keeps sending until the user picks a row.
 */
export function useRecipesMenu({
  draft,
  onDraftChange,
  recipes,
  field,
  onPicked,
}: UseRecipesMenuInput): RecipesMenuState {
  const [mode, setMode] = useState<RecipesOpenMode | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Set by a pick: the next draft change is our own fill and must not reopen the flyout.
  const suppress = useRef(false);

  const visible = useMemo(
    () => (mode === 'slash' ? filterRecipes(recipes, draft) : [...recipes]),
    [mode, recipes, draft],
  );

  // The slash filter reacts to each text change; a draft without the slash hides the flyout. A
  // pick fills the draft itself: skip the filter once, then focus the field with the caret at the end.
  useEffect(() => {
    if (suppress.current) {
      suppress.current = false;
      const el = field.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      return;
    }
    if (draft.startsWith('/')) {
      setMode('slash');
      setActiveIndex(-1);
    } else {
      setMode(null);
    }
  }, [draft, field]);

  const close = useCallback(() => {
    setMode(null);
    setActiveIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    setActiveIndex(-1);
    setMode((current) => (current === null ? 'button' : null));
    field.current?.focus();
  }, [field]);

  const pick = useCallback(
    (recipe: ChatRecipe) => {
      suppress.current = true;
      close();
      if (recipe.prompt === draft) {
        // Nothing changes, so no render follows: finish the focus work now.
        suppress.current = false;
        const el = field.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
        onPicked?.(recipe);
        return;
      }
      onDraftChange(recipe.prompt);
      onPicked?.(recipe);
    },
    [close, draft, field, onDraftChange, onPicked],
  );

  const isOpen = mode !== null;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      if (!isOpen) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return true;
      }
      if (visible.length === 0) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % visible.length);
        return true;
      }
      if (event.key === 'ArrowUp' && activeIndex >= 0) {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + visible.length) % visible.length);
        return true;
      }
      const chosen = visible[activeIndex];
      if (event.key === 'Enter' && chosen && !event.shiftKey) {
        event.preventDefault();
        pick(chosen);
        return true;
      }
      return false;
    },
    [activeIndex, close, isOpen, pick, visible],
  );

  return { isOpen, visible, activeIndex, toggle, close, pick, handleKeyDown };
}
