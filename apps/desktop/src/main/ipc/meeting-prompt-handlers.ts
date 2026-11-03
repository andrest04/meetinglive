import {
  meetingPromptDismiss,
  meetingPromptHover,
  meetingPromptNeverAgain,
  meetingPromptReady,
  meetingPromptStart,
} from '@vozella/contracts';
import { registerRequest, type IpcServerDeps } from './ipc-server';

/** What the popup buttons call. The detection controller owns the rules. */
export interface MeetingPromptActions {
  startTakingNotes(): void;
  dismiss(): void;
  neverAgain(): Promise<void>;
  /** The pointer entered or left the card: pauses and restarts the auto-hide. */
  hover(inside: boolean): void;
  /** Is the popup showing now (answered to a page that just started). */
  isShown(): boolean;
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
  registerRequest(server, meetingPromptReady, () => ({ shown: actions.isShown() }));
  registerRequest(server, meetingPromptHover, (input) => {
    actions.hover(input.inside);
    return { done: true as const };
  });
  registerRequest(server, meetingPromptNeverAgain, async () => {
    await actions.neverAgain();
    return { done: true as const };
  });
}
