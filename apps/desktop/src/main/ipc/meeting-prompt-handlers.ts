import {
  meetingPromptDismiss,
  meetingPromptNeverAgain,
  meetingPromptStart,
} from '@vozella/contracts';
import { registerRequest, type IpcServerDeps } from './ipc-server';

/** What the popup buttons call. The detection controller owns the rules. */
export interface MeetingPromptActions {
  startTakingNotes(): void;
  dismiss(): void;
  neverAgain(): Promise<void>;
}

export function registerMeetingPromptHandlers(
  server: IpcServerDeps,
  actions: MeetingPromptActions,
): void {
  registerRequest(server, meetingPromptStart, () => {
    actions.startTakingNotes();
    return { done: true as const };
  });
  registerRequest(server, meetingPromptDismiss, () => {
    actions.dismiss();
    return { done: true as const };
  });
  registerRequest(server, meetingPromptNeverAgain, async () => {
    await actions.neverAgain();
    return { done: true as const };
  });
}
