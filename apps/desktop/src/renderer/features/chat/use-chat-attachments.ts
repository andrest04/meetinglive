import type { ChatAttachmentDto, ChatAttachmentListDto } from '@vozella/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

/** The drop bridge the preload exposes. Paths are read there and never reach the page. */
interface ChatFilesBridge {
  attachToChat(files: readonly File[]): Promise<ChatAttachmentListDto>;
}

declare global {
  interface Window {
    readonly vozellaFiles?: ChatFilesBridge;
  }
}

export interface ChatAttachments {
  readonly items: readonly ChatAttachmentDto[];
  /** A line about the last action or answer (files over the limit, images left out), or null. */
  readonly notice: string | null;
  readonly setNotice: (notice: string | null) => void;
  readonly pick: () => Promise<void>;
  readonly drop: (files: readonly File[]) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  /** The current items, for a send that reads them when it starts. */
  readonly current: () => readonly ChatAttachmentDto[];
}

/**
 * The files attached to the conversation, mirrored from main: the chat state carries them, so New
 * chat (which clears them in main) clears the chips too. The page only ever holds ids.
 */
export function useChatAttachments(): ChatAttachments {
  const [items, setItemsState] = useState<readonly ChatAttachmentDto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<readonly ChatAttachmentDto[]>([]);
  const alive = useRef(true);

  const setItems = useCallback((next: readonly ChatAttachmentDto[]): void => {
    itemsRef.current = next;
    setItemsState(next);
  }, []);

  useEffect(() => {
    alive.current = true;
    void window.vozella
      .invoke('chat.attach.list', {})
      .then((list) => {
        if (alive.current) setItems(list.attachments);
      })
      .catch(() => undefined);
    const off = window.vozella.on('chat.stateChanged', ({ state }) => {
      setItems(state.attachments);
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [setItems]);

  const apply = useCallback(
    (list: ChatAttachmentListDto): void => {
      if (!alive.current) return;
      setItems(list.attachments);
      setNotice(list.notice);
    },
    [setItems],
  );

  const pick = useCallback(async (): Promise<void> => {
    try {
      apply(await window.vozella.invoke('chat.attach.pick', {}));
    } catch {
      // The dialog failed to open; main logged it.
    }
  }, [apply]);

  const drop = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const bridge = window.vozellaFiles;
      if (bridge === undefined || files.length === 0) return;
      try {
        apply(await bridge.attachToChat([...files]));
      } catch {
        // Main refused the drop as a whole (an invalid request); nothing was added.
      }
    },
    [apply],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        apply(await window.vozella.invoke('chat.attach.remove', { id }));
      } catch {
        // Main is gone; the state event will correct the chips.
      }
    },
    [apply],
  );

  const current = useCallback(() => itemsRef.current, []);

  return { items, notice, setNotice, pick, drop, remove, current };
}
