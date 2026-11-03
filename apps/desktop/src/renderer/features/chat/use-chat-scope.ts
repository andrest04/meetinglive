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
  const last = useRef<ChatScopeDecision | null>(null);

  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      generation.current += 1;
      const mine = generation.current;
      const stale = (): boolean => disposed || mine !== generation.current;
      const state = await window.vozella.invoke('workspace.getState', {});
      if (stale()) return;
      const next = resolveScopeFromWorkspace(state);
      const changed = !same(last.current, next);
      last.current = next;
      if (changed) {
        setName(null);
        setDecision(next);
      }
      // A rename arrives as the same decision, so the name is looked up on every refresh.
      const resolved = await lookupName(next).catch(() => null);
      if (stale()) return;
      setName(resolved);
      if (changed) {
        const chat = await window.vozella
          .invoke('chat.setScope', { scope: next })
          .catch(() => null);
        if (!stale() && chat !== null) setCanStartNewChat(chat.canStartNewChat);
      }
    };
    const run = (): void => {
      void refresh().catch(() => undefined);
    };
    run();
    const offWorkspace = window.vozella.on('workspace.changed', run);
    const offLibrary = window.vozella.on('library.changed', run);
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
