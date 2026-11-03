import { sessionGetView, sessionRename, sessionRevealFile } from '@vozella/contracts';
import {
  deriveSessionView,
  MeetingFormatError,
  renameMeeting,
  resolveRevealTarget,
  type MeetingRecord,
  type MeetingRepository,
  type RevealPort,
  type RunnerStateLike,
  type Workspace,
} from '@vozella/core';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface SessionHandlerDeps {
  readonly server: IpcServerDeps;
  readonly meetings: Pick<MeetingRepository, 'get' | 'save'>;
  readonly workspace: Pick<Workspace, 'notifyMeetingChanged'>;
  /** The re-transcription runner state; a rename during a run for that meeting is blocked (B4). */
  readonly runnerState: () => RunnerStateLike;
  /** True for a readable file with at least one byte (B20). */
  readonly fileExists: (path: string) => boolean;
  readonly reveal: RevealPort;
}

/** Wires the session page channels. The rules live in core; copy reuses summaries.writeClipboard. */
export function registerSessionHandlers(deps: SessionHandlerDeps): void {
  const { server, meetings, workspace, runnerState, fileExists, reveal } = deps;

  /** A file that cannot be parsed counts as no meeting, like library.getMeeting. */
  const read = async (id: string): Promise<MeetingRecord | null> => {
    try {
      return await meetings.get(id);
    } catch (error) {
      if (error instanceof MeetingFormatError) return null;
      throw error;
    }
  };

  registerRequest(server, sessionGetView, async ({ id }) => {
    const record = await read(id);
    const view = deriveSessionView(record, fileExists);
    return { record, hasTranscript: view.hasTranscript, hasAudio: view.hasAudio };
  });

  registerRequest(server, sessionRename, async ({ id, title }) => ({
    status: await renameMeeting({ meetings, workspace, runnerState }, id, title),
  }));

  registerRequest(server, sessionRevealFile, async ({ id }) => {
    const target = resolveRevealTarget(await read(id), fileExists);
    if (target === null) return { revealed: false };
    await reveal.reveal(target);
    return { revealed: true };
  });
}
