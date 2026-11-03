import {
  chatCancel,
  chatCopyText,
  chatMeetingExists,
  chatNewChat,
  chatOpenExternal,
  chatSend,
  chatSetScope,
  chatState,
} from '@vozella/contracts';
import type { ChatController } from '../chat/chat-controller';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface ChatHandlerDeps {
  readonly server: IpcServerDeps;
  readonly controller: ChatController;
}

/** Wires the chat channels. One line per channel; the rules live in core. */
export function registerChatHandlers({ server, controller }: ChatHandlerDeps): void {
  registerRequest(server, chatSend, (input) => controller.send(input));
  registerRequest(server, chatCancel, () => ({ cancelled: controller.cancel() }));
  registerRequest(server, chatNewChat, () => ({ started: controller.newChat() }));
  registerRequest(server, chatState, () => controller.state());
  registerRequest(server, chatSetScope, ({ scope }) => controller.setScope(scope));
  registerRequest(server, chatMeetingExists, ({ meetingId }) =>
    controller.meetingExists(meetingId),
  );
  registerRequest(server, chatCopyText, ({ text }) => controller.copyText(text));
  registerRequest(server, chatOpenExternal, ({ url }) => controller.openExternal(url));
}
