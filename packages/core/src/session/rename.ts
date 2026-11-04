import type { MeetingRepository } from '../library/ports';
import type { Workspace } from '../library/workspace';
import type { RunnerStateLike } from './session-view';

export type RenameOutcome = 'renamed' | 'unchanged' | 'blocked' | 'missing';

export interface RenameDeps {
  readonly meetings: Pick<MeetingRepository, 'get' | 'save'>;
  readonly workspace: Pick<Workspace, 'notifyMeetingChanged'>;
  readonly runnerState: () => RunnerStateLike;
}

/** The rename dialog confirms only a non-blank name (item 29). */
export function canSubmitRename(text: string | null | undefined): boolean {
  return (text ?? '').trim() !== '';
}

/**
 * Items 29 to 34 and B4/B11. Saves the whole record under its own id, so the file stays
 * `{id}.md`, and raises `meetingChanged` so lists and chat scope refresh. The workspace keeps
 * only the last processed id, not its title, so there is no title to update there.
 */
export async function renameMeeting(
  deps: RenameDeps,
  id: string | null | undefined,
  text: string,
): Promise<RenameOutcome> {
  const title = text.trim();
  if (!id || title === '') return 'missing';
  const run = deps.runnerState();
  if (run.isRunning && run.meetingId === id) return 'blocked';
  const record = await deps.meetings.get(id);
  if (record === null) return 'missing';
  if (record.title === title) return 'unchanged';
  await deps.meetings.save({ ...record, title });
  deps.workspace.notifyMeetingChanged(id);
  return 'renamed';
}
