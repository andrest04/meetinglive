import {
  chatPromptsCreate,
  chatPromptsDelete,
  chatPromptsExport,
  chatPromptsImport,
  chatPromptsList,
  chatPromptsUpdate,
} from '@vozella/contracts';
import type { ChatPromptsController } from '../chat/chat-prompts-controller';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface ChatPromptHandlerDeps {
  readonly server: IpcServerDeps;
  readonly controller: ChatPromptsController;
}

/** Wires the saved prompt channels (Phase 5). The rules live in core and the store. */
export function registerChatPromptHandlers({ server, controller }: ChatPromptHandlerDeps): void {
  registerRequest(server, chatPromptsList, () => controller.list());
  registerRequest(server, chatPromptsCreate, ({ draft }) => controller.create(draft));
  registerRequest(server, chatPromptsUpdate, ({ id, draft }) => controller.update(id, draft));
  registerRequest(server, chatPromptsDelete, ({ id }) => controller.remove(id));
  registerRequest(server, chatPromptsExport, () => controller.exportAll());
  registerRequest(server, chatPromptsImport, () => controller.importFile());
}
