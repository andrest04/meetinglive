import { z } from 'zod';
import { defineRequest } from './channel';
import { meetingRecordSchema } from './library';

/** Session page channels (module: session-views). Copy reuses `summaries.writeClipboard`. */

const guid = z.string().min(1);

/** B20: a missing, unreadable or zero-byte audio file is "no audio". */
export const sessionGetView = defineRequest('session.getView', {
  input: z.object({ id: guid }),
  output: z.object({
    record: meetingRecordSchema.nullable(),
    hasTranscript: z.boolean(),
    hasAudio: z.boolean(),
  }),
});

export const renameOutcomeSchema = z.enum(['renamed', 'unchanged', 'blocked', 'missing']);

export const sessionRename = defineRequest('session.rename', {
  input: z.object({ id: guid, title: z.string().max(1_000) }),
  output: z.object({ status: renameOutcomeSchema }),
});

/** False when the meeting, its path or its file is missing; the page picks the message (B13). */
export const sessionRevealFile = defineRequest('session.revealFile', {
  input: z.object({ id: guid }),
  output: z.object({ revealed: z.boolean() }),
});
