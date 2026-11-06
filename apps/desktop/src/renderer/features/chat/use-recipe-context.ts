import type { ChatScopeDecision, RecipeContext } from '@vozella/core';
import { useEffect, useState } from 'react';

const NONE: RecipeContext = {};

/**
 * What the recipe lists need to know about the scoped meeting: whether it has action items. A
 * meeting without them reads as a talk, a video or a class and gets the content starters. It reads
 * the meeting through the existing `library.getMeeting` call and reads it again when the library
 * changes, so a summary that adds action items switches the chips. Null while a meeting scope is
 * still being looked up; other scopes need nothing and answer at once.
 */
export function useRecipeContext(scope: ChatScopeDecision): RecipeContext | null {
  const meetingId = scope.kind === 'Meeting' ? scope.meetingId : null;
  const [loaded, setLoaded] = useState<{ id: string; context: RecipeContext } | null>(null);

  useEffect(() => {
    if (meetingId === null) return;
    let alive = true;
    // Only the newest read may answer, so a slow earlier read cannot undo a later one.
    let latest = 0;
    const read = (): void => {
      latest += 1;
      const mine = latest;
      void window.vozella
        .invoke('library.getMeeting', { id: meetingId })
        .then(({ record }) => (record?.actionItems.length ?? 0) > 0)
        // A meeting that cannot be read is treated as content: those starters always make sense.
        .catch(() => false)
        .then((hasActionItems) => {
          if (alive && mine === latest) setLoaded({ id: meetingId, context: { hasActionItems } });
        });
    };
    read();
    const off = window.vozella.on('library.changed', read);
    return () => {
      alive = false;
      off();
    };
  }, [meetingId]);

  if (meetingId === null) return NONE;
  return loaded?.id === meetingId ? loaded.context : null;
}
