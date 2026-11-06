import { describe, expect, it } from 'vitest';
import {
  appSettingsSchema,
  eventChannels,
  recordingDismissQuestion,
  recordingQuestionDetected,
  recordingQuestionWithdrawn,
  requestChannels,
} from './index';

describe('live question contracts', () => {
  it('registers the question events and the dismiss request', () => {
    expect(eventChannels['recording.questionDetected']).toBe(recordingQuestionDetected);
    expect(eventChannels['recording.questionWithdrawn']).toBe(recordingQuestionWithdrawn);
    expect(requestChannels['recording.dismissQuestion']).toBe(recordingDismissQuestion);
  });

  it('carries the card and refuses a payload without the confirmed flag', () => {
    const card = { id: 'q1', body: '¿Qué es Scrum?', atMs: 4000, confirmed: false };
    expect(recordingQuestionDetected.payload.parse(card)).toEqual(card);
    expect(
      recordingQuestionDetected.payload.safeParse({ ...card, confirmed: undefined }).success,
    ).toBe(false);
    expect(recordingQuestionWithdrawn.payload.parse({ id: 'q1' })).toEqual({ id: 'q1' });
  });

  it('lets Settings patch the live questions mode', () => {
    expect(appSettingsSchema.partial().strict().safeParse({ liveQuestions: 'off' }).success).toBe(
      true,
    );
  });
});
