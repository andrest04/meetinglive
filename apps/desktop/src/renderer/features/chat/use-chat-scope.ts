import type { WorkspaceStateDto } from '@vozella/contracts';
import { resolveScopeFromWorkspace, type ChatScopeDecision } from '@vozella/core';
import { useEffect, useRef, useState } from 'react';

export interface ChatScopeView {
  readonly decision: ChatScopeDecision;
  /** Meeting title or folder name once looked up; null while unknown or when it does not exist. */
  readonly name: string | null;
  readonly canStartNewChat: boolean;
}

const HIDDEN: ChatScopeDecision = {
  isVisible: false,
  kind: 'AllMeetings',
  folderId: null,
  meetingId: null,
};

async function lookupName(decision: ChatScopeDecision): Promise<string | null> {
  if (decision.kind === 'Meeting' && decision.meetingId !== null) {
    const { record } = await window.vozella.invoke('library.getMeeting', {
      id: decision.meetingId,
    });
    return record?.title ?? null;
  }
  if (decision.kind === 'Folder' && decision.folderId !== null) {
    const loaded = await window.vozella.invoke('library.load', {});
    if (!loaded.ok) return null;
    return loaded.folders.find((folder) => folder.id === decision.folderId)?.name ?? null;
  }
  return null;
}

function same(a: ChatScopeDecision | null, b: ChatScopeDecision): boolean {
  return (
    a !== null &&
    a.isVisible === b.isVisible &&
    a.kind === b.kind &&
    a.folderId === b.folderId &&
    a.meetingId === b.meetingId
  );
}

/**
 * The scope the chat bar shows, from the workspace state main pushes (parity 1 to 11, 18). Each
 * refresh starts a new generation, so a name lookup that finishes late is discarded.
 */
export function useChatScope(): ChatScopeView {
  const [decision, setDecision] = useState<ChatScopeDecision>(HIDDEN);
  const [name, setName] = useState<string | null>(null);
  const [canStartNewChat, setCanStartNewChat] = useState(false);
  const generation = useRef(0);
  /** The decision the page last showed, and the one last delivered to main. */
  const last = useRef<ChatScopeDecision | null>(null);
  const delivered = useRef<ChatScopeDecision | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = async (known?: WorkspaceStateDto): Promise<void> => {
      generation.current += 1;
      const mine = generation.current;
      const stale = (): boolean => disposed || mine !== generation.current;
      const state = known ?? (await window.vozella.invoke('workspace.getState', {}));
      if (stale()) return;
      const next = resolveScopeFromWorkspace(state);
      const changed = !same(last.current, next);
      last.current = next;
      if (changed) {
        setName(null);
        setDecision(next);
      }
      // Main must hear the final scope even when a later refresh makes this one stale, so the
      // delivery is tracked on its own and is not gated by the generation.
      if (!same(delivered.current, next)) {
        delivered.current = next;
        void window.vozella
          .invoke('chat.setScope', { scope: next })
          .then((chat) => {
            if (!disposed && same(delivered.current, next))
              setCanStartNewChat(chat.canStartNewChat);
          })
          .catch(() => {
            if (same(delivered.current, next)) delivered.current = null;
          });
      }
      // A rename arrives as the same decision, so the name is looked up on every refresh.
      const resolved = await lookupName(next).catch(() => null);
      if (stale()) return;
      setName(resolved);
    };
    const run = (state?: WorkspaceStateDto): void => {
      void refresh(state).catch(() => undefined);
    };
    run();
    // Live transcript text changes arrive here too; they never change the scope, so skip them.
    const offWorkspace = window.vozella.on('workspace.changed', ({ state }) => {
      if (same(last.current, resolveScopeFromWorkspace(state))) return;
      run(state);
    });
    const offLibrary = window.vozella.on('library.changed', () => {
      run();
    });
    const offChat = window.vozella.on('chat.stateChanged', ({ state }) => {
      setCanStartNewChat(state.canStartNewChat);
    });
    return () => {
      disposed = true;
      offWorkspace();
      offLibrary();
      offChat();
    };
  }, []);

  return { decision, name, canStartNewChat };
}
