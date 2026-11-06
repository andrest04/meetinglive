import {
  CHAT_ATTACHMENT_MAX,
  type ChatAttachmentListDto,
  type VozellaApi,
} from '@vozella/contracts';

/** What the page may do with files the user dropped: hand them to the chat. Nothing else. */
export interface ChatFilesBridge {
  /** Attaches dropped files to the chat. Files without a path on disk are skipped. */
  attachToChat(files: readonly File[]): Promise<ChatAttachmentListDto>;
}

/**
 * The drop bridge. `pathOf` is Electron's `webUtils.getPathForFile`; it answers '' for a File the
 * page built itself, so only real dropped files reach main, where each path is checked again.
 */
export function createChatFilesBridge(
  api: Pick<VozellaApi, 'invoke'>,
  pathOf: (file: File) => string,
): ChatFilesBridge {
  return {
    attachToChat: (files) => {
      const paths = [...files]
        .map((file) => {
          try {
            return pathOf(file);
          } catch {
            return '';
          }
        })
        .filter((path) => path !== '')
        .slice(0, CHAT_ATTACHMENT_MAX);
      if (paths.length === 0) return api.invoke('chat.attach.list', {});
      return api.invoke('chat.attach.drop', { paths });
    },
  };
}
