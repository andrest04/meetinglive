import { describe, expect, it, vi } from 'vitest';
import type { MeetingRecord } from '../../library/meeting';
import { makeMeeting, TEST_MEETING_ID } from '../pipeline/pipeline-test-kit';
import type { Message } from '../recording-status';
import { RecordingSessionGate } from '../session-gate';
import { CLOSE_GRACE_MS, RecordingRuns } from './recording-runs';

const msg = (key: string, ...args: string[]): Message => ({ key, args });
const keys = (line: readonly Message[]): string[] => line.map((m) => m.key);
const OTHER_ID = '33333333-3333-3333-3333-333333333333';

function setup() {
  const gate = new RecordingSessionGate();
  const spies = {
    notes: 'page notes',
    setLastProcessed: vi.fn<(r: MeetingRecord) => void>(),
    notifyMeetingChanged: vi.fn<(id: string) => void>(),
    captureActive: vi.fn<(a: boolean) => void>(),
    resetTitle: vi.fn(),
    processingFinished: vi.fn(),
    timers: [] as { fn: () => void; ms: number; cancelled: boolean }[],
  };
  const runs = new RecordingRuns({
    gate,
    notes: () => spies.notes,
    workspace: {
      setLastProcessed: spies.setLastProcessed,
      notifyMeetingChanged: spies.notifyMeetingChanged,
      setCaptureActive: spies.captureActive,
    },
    session: { resetTitle: spies.resetTitle, onProcessingFinished: spies.processingFinished },
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      spies.timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  return { gate, runs, spies };
}

/** Walks the gate the way a take does: record, stop, process. */
function recordAndStop(ctx: ReturnType<typeof setup>, meetingId = TEST_MEETING_ID) {
  ctx.runs.beginTake();
  ctx.gate.tryBeginPreparing();
  ctx.gate.markRecording();
  ctx.gate.tryBeginStopping();
  ctx.gate.markProcessing();
  return ctx.runs.startRun({ meetingId });
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('host callback matrix', () => {
  it('CurrentSessionNotes: the page box while owning, the snapshot after release', () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    expect(run.currentSessionNotes).toBe('page notes');
    run.onFinished(msg('Done'));
    ctx.spies.notes = 'next take notes';
    expect(run.currentSessionNotes).toBe('page notes');
  });

  it('keeps the notes snapshot taken at stop, not the later box', () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    ctx.spies.notes = 'typed after stop';
    run.onFinished(msg('Done'));
    ctx.spies.notes = 'a newer take';
    expect(run.currentSessionNotes).toBe('page notes');
  });

  it('OnStatusChanged and OnTranscriptRefreshed apply only while owning', () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onStatusChanged(msg('Status_Transcribing'));
    run.onTranscriptRefreshed('live words');
    expect(keys(ctx.runs.status)).toEqual(['Status_Transcribing']);
    expect(ctx.runs.liveTranscript).toBe('live words');
    run.onFinished(msg('Done'));
    run.onStatusChanged(msg('Late'));
    run.onTranscriptRefreshed('late words');
    expect(keys(ctx.runs.status)).toEqual(['Done']);
    expect(ctx.runs.liveTranscript).toBe('live words');
  });

  it('OnMeetingSaved from the latest run sets last processed and the last meeting', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    const record = makeMeeting();
    run.onMeetingSaved(record);
    expect(ctx.spies.setLastProcessed).toHaveBeenCalledWith(record);
    expect(ctx.runs.lastMeeting).toBe(record);
    expect(await run.firstSave).toBe(true);
  });

  it('OnMeetingSaved from an older run only notifies the workspace', async () => {
    const ctx = setup();
    const first = recordAndStop(ctx);
    first.onFinished(msg('Done'));
    const second = recordAndStop(ctx, OTHER_ID);
    first.onMeetingSaved(makeMeeting());
    expect(ctx.spies.notifyMeetingChanged).toHaveBeenCalledWith(TEST_MEETING_ID);
    expect(ctx.spies.setLastProcessed).not.toHaveBeenCalled();
    expect(ctx.runs.latestRun).toBe(second);
    expect(await first.firstSave).toBe(true);
  });

  it('OnFinished releases without a title reset; the reset variants reset it', () => {
    const ctx = setup();
    recordAndStop(ctx).onFinished(msg('Failed'));
    expect(ctx.spies.resetTitle).not.toHaveBeenCalled();
    expect(ctx.gate.phase).toBe('Idle');
    expect(ctx.spies.processingFinished).toHaveBeenCalledTimes(1);

    recordAndStop(ctx).onTitleResetAndFinished(msg('Done'));
    recordAndStop(ctx).onSummaryFailedAfterTranscriptSaved(TEST_MEETING_ID, msg('SummaryFailed'));
    recordAndStop(ctx).onSavedWithoutTranscript(TEST_MEETING_ID, msg('NoTranscript'));
    expect(ctx.spies.resetTitle).toHaveBeenCalledTimes(3);
    expect(keys(ctx.runs.status)).toEqual(['NoTranscript']);
  });

  it('OnMeetingCompleted sets the status only when idle on that meeting', () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onMeetingSaved(makeMeeting());
    run.onMeetingCompleted(TEST_MEETING_ID, msg('Busy'));
    expect(keys(ctx.runs.status)).toEqual([]);
    run.onFinished(msg('Saved'));
    run.onMeetingCompleted(OTHER_ID, msg('WrongMeeting'));
    expect(keys(ctx.runs.status)).toEqual(['Saved']);
    run.onMeetingCompleted(TEST_MEETING_ID, msg('Summary ready'));
    expect(keys(ctx.runs.status)).toEqual(['Summary ready']);
  });

  it('endOrReport shows the status when the run lost the session but the page is idle on its meeting', () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onMeetingSaved(makeMeeting());
    run.onFinished(msg('First'));
    run.onSummaryFailedAfterTranscriptSaved(TEST_MEETING_ID, msg('Background failed'));
    expect(keys(ctx.runs.status)).toEqual(['Background failed']);
    expect(ctx.spies.resetTitle).not.toHaveBeenCalled();
  });
});

describe('hand-off and late callbacks', () => {
  it('a handed-off run can never reset or mutate the next take', () => {
    const ctx = setup();
    const first = recordAndStop(ctx);
    first.onMeetingSaved(makeMeeting());
    first.onFinished(msg('Handed off'));
    const second = recordAndStop(ctx, OTHER_ID);
    second.onStatusChanged(msg('Second status'));
    ctx.spies.resetTitle.mockClear();
    const releases = ctx.spies.processingFinished.mock.calls.length;

    first.onTitleResetAndFinished(msg('Late summary'));
    first.onSummaryFailedAfterTranscriptSaved(TEST_MEETING_ID, msg('Late failure'));
    first.onSavedWithoutTranscript(TEST_MEETING_ID, msg('Late nothing'));
    first.onStatusChanged(msg('Late status'));
    first.onTranscriptRefreshed('late transcript');
    first.onMeetingCompleted(TEST_MEETING_ID, msg('Late done'));

    expect(ctx.spies.resetTitle).not.toHaveBeenCalled();
    expect(ctx.spies.processingFinished).toHaveBeenCalledTimes(releases);
    expect(ctx.runs.activeRun).toBe(second);
    expect(ctx.gate.phase).toBe('Processing');
    expect(keys(ctx.runs.status)).toEqual(['Second status']);
    expect(ctx.runs.liveTranscript).toBe('');
  });

  it('releaseSession is idempotent', () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    expect(ctx.runs.releaseSession(run, [msg('A')], true)).toBe(true);
    expect(ctx.runs.releaseSession(run, [msg('B')], true)).toBe(false);
    expect(ctx.spies.resetTitle).toHaveBeenCalledTimes(1);
    expect(keys(ctx.runs.status)).toEqual(['A']);
  });

  it('a run that completed ignores every later callback', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.complete();
    await run.completion;
    expect(await run.firstSave).toBe(false);
    run.onMeetingSaved(makeMeeting());
    run.onFinished(msg('Late'));
    expect(ctx.spies.setLastProcessed).not.toHaveBeenCalled();
    expect(ctx.runs.runs).toHaveLength(0);
  });

  it('complete is queued behind callbacks already posted', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onStatusChanged(msg('Working'));
    run.complete();
    run.onFinished(msg('Final'));
    await run.completion;
    expect(keys(ctx.runs.status)).toEqual(['Final']);
    expect(ctx.runs.runs).toHaveLength(0);
  });

  it('complete releases the session with the last status and no reset', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onStatusChanged(msg('Working'));
    run.complete();
    await run.completion;
    expect(ctx.gate.phase).toBe('Idle');
    expect(keys(ctx.runs.status)).toEqual(['Working']);
    expect(ctx.spies.resetTitle).not.toHaveBeenCalled();
  });
});

describe('capture failure prefix and soft warnings', () => {
  it('prefixes the capture failure of the take to every status (161)', () => {
    const ctx = setup();
    ctx.runs.beginTake();
    ctx.gate.tryBeginPreparing();
    ctx.gate.markRecording();
    ctx.runs.noteCaptureEvent({ kind: 'faulted', message: 'disk full' });
    ctx.gate.tryBeginStopping();
    ctx.gate.markProcessing();
    const run = ctx.runs.startRun({ meetingId: TEST_MEETING_ID });
    run.onStatusChanged(msg('Status_Transcribing'));
    expect(keys(ctx.runs.status)).toEqual(['Error_CaptureFaulted', 'Status_Transcribing']);
  });

  it('keeps the soft warning in the post-stop status of that take (B-24)', () => {
    const ctx = setup();
    ctx.runs.beginTake();
    ctx.gate.tryBeginPreparing();
    ctx.gate.markRecording();
    ctx.runs.noteCaptureEvent({ kind: 'source-lost', source: 'Microphone', remaining: 1 });
    expect(keys(ctx.runs.status)).toEqual(['Warning_MicrophoneLost']);
    ctx.gate.tryBeginStopping();
    ctx.gate.markProcessing();
    const run = ctx.runs.startRun({ meetingId: TEST_MEETING_ID });
    run.onStatusChanged(msg('Status_Transcribing'));
    expect(keys(ctx.runs.status)).toEqual(['Status_Transcribing', 'Warning_MicrophoneLost']);
    run.onFinished(msg('Done'));
    expect(keys(ctx.runs.status)).toEqual(['Done', 'Warning_MicrophoneLost']);
  });

  it('nothing-left outranks other warnings and the next take starts clean', () => {
    const ctx = setup();
    ctx.runs.beginTake();
    ctx.gate.tryBeginPreparing();
    ctx.gate.markRecording();
    ctx.runs.noteCaptureEvent({ kind: 'source-lost', source: 'Output', remaining: 0 });
    ctx.runs.noteCaptureEvent({ kind: 'source-lost', source: 'Microphone', remaining: 1 });
    expect(ctx.runs.takeSoftWarning?.key).toBe('Warning_NoAudioSourcesLeft');
    ctx.runs.beginTake();
    expect(ctx.runs.takeSoftWarning).toBeNull();
    expect(ctx.runs.status).toEqual([]);
  });

  it('handles only the first hard failure and asks to stop while recording', () => {
    const ctx = setup();
    ctx.runs.beginTake();
    ctx.gate.tryBeginPreparing();
    ctx.gate.markRecording();
    const first = ctx.runs.noteCaptureEvent({ kind: 'output-failed', message: 'a' });
    const second = ctx.runs.noteCaptureEvent({ kind: 'faulted', message: 'b' });
    expect(first?.stopRecording).toBe(true);
    expect(second).toBeNull();
    expect(ctx.runs.takeCaptureFailure?.args).toEqual(['a']);
  });

  it('B-30: a stop error after a notified failure keeps the failure first', () => {
    const ctx = setup();
    ctx.runs.beginTake();
    ctx.gate.tryBeginPreparing();
    ctx.gate.markRecording();
    ctx.runs.noteCaptureEvent({ kind: 'faulted', message: 'disk full' });
    ctx.gate.tryBeginStopping();
    ctx.runs.reportStopError(msg('Error_StopRecording', 'boom'));
    expect(keys(ctx.runs.status)).toEqual(['Error_CaptureFaulted', 'Error_StopRecording']);
  });

  it('B-30: a failure arriving after the stop error still ends up first', () => {
    const ctx = setup();
    ctx.runs.beginTake();
    ctx.gate.tryBeginPreparing();
    ctx.gate.markRecording();
    ctx.gate.tryBeginStopping();
    ctx.runs.reportStopError(msg('Error_StopRecording', 'boom'));
    const result = ctx.runs.noteCaptureEvent({ kind: 'output-failed', message: 'x' });
    expect(result?.stopRecording).toBe(false);
    expect(keys(ctx.runs.status)).toEqual(['Error_OutputCaptureFailed', 'Error_StopRecording']);
  });
});

describe('link state (B-26) and queries', () => {
  it('an error end clears the link, so the next unrelated take never reuses the meeting id', () => {
    const ctx = setup();
    ctx.runs.beginTake({ meetingId: OTHER_ID });
    expect(ctx.runs.currentMeetingId).toBe(OTHER_ID);
    ctx.gate.tryBeginPreparing();
    ctx.gate.markRecording();
    ctx.gate.tryBeginStopping();
    ctx.gate.markProcessing();
    const run = ctx.runs.startRun({ meetingId: OTHER_ID });
    run.onFinished(msg('Failed'));
    expect(ctx.runs.currentMeetingId).toBeNull();
    ctx.runs.beginTake();
    expect(ctx.runs.currentMeetingId).toBeNull();
  });

  it('isMeetingInUse: a run with that id, or the current meeting while not idle', () => {
    const ctx = setup();
    ctx.runs.beginTake({ meetingId: OTHER_ID });
    expect(ctx.runs.isMeetingInUse(OTHER_ID)).toBe(false);
    ctx.gate.tryBeginPreparing();
    expect(ctx.runs.isMeetingInUse(OTHER_ID)).toBe(true);
    ctx.gate.cancelPreparing();
    const run = recordAndStop(ctx);
    expect(ctx.runs.isMeetingInUse(TEST_MEETING_ID)).toBe(true);
    run.onFinished(msg('Done'));
    expect(ctx.runs.isMeetingInUse(TEST_MEETING_ID)).toBe(true);
    run.complete();
    return run.completion.then(() => {
      expect(ctx.runs.isMeetingInUse(TEST_MEETING_ID)).toBe(false);
    });
  });

  it('isCaptureActive mirrors recording or processing and pushes it to the workspace (166)', () => {
    const ctx = setup();
    expect(ctx.runs.isCaptureActive).toBe(false);
    ctx.gate.tryBeginPreparing();
    expect(ctx.runs.isCaptureActive).toBe(false);
    ctx.gate.markRecording();
    expect(ctx.runs.isCaptureActive).toBe(true);
    ctx.gate.tryBeginStopping();
    expect(ctx.runs.isCaptureActive).toBe(false);
    ctx.gate.markProcessing();
    expect(ctx.runs.isCaptureActive).toBe(true);
    ctx.gate.markIdle();
    expect(ctx.spies.captureActive.mock.calls.map((c) => c[0])).toEqual([true, false, true, false]);
  });

  it('clears the last meeting when it is deleted (162)', () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onMeetingSaved(makeMeeting());
    ctx.runs.clearLastMeetingIf(OTHER_ID);
    expect(ctx.runs.lastMeeting).not.toBeNull();
    ctx.runs.clearLastMeetingIf(TEST_MEETING_ID);
    expect(ctx.runs.lastMeeting).toBeNull();
  });

  it('cancelActiveRun cancels the foreground run only', () => {
    const ctx = setup();
    expect(ctx.runs.cancelActiveRun()).toBe(false);
    const run = recordAndStop(ctx);
    expect(ctx.runs.cancelActiveRun()).toBe(true);
    expect(run.cancel.cancelled).toBe(true);
  });
});

describe('saveAndFinishForClose', () => {
  it('returns true when every run saved', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    const stop = vi.fn(() => Promise.resolve());
    const result = ctx.runs.saveAndFinishForClose(stop);
    await flush();
    run.onMeetingSaved(makeMeeting());
    await flush();
    expect(run.cancel.cancelled).toBe(true);
    run.complete();
    expect(await result).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('returns false when a first save never happened', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    const result = ctx.runs.saveAndFinishForClose(() => Promise.resolve());
    await flush();
    run.complete();
    expect(await result).toBe(false);
  });

  it('returns true with no runs', async () => {
    const ctx = setup();
    expect(await ctx.runs.saveAndFinishForClose(() => Promise.resolve())).toBe(true);
  });

  it('gives runs 30 s to wind down and then returns', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onMeetingSaved(makeMeeting());
    let done = false;
    const result = ctx.runs
      .saveAndFinishForClose(() => Promise.resolve())
      .then((value) => {
        done = true;
        return value;
      });
    await flush();
    await flush();
    expect(done).toBe(false);
    const timer = ctx.spies.timers[0]!;
    expect(timer.ms).toBe(CLOSE_GRACE_MS);
    timer.fn();
    expect(await result).toBe(true);
    expect(run.cancel.cancelled).toBe(true);
  });

  it('cancels the grace timer when the runs finish first', async () => {
    const ctx = setup();
    const run = recordAndStop(ctx);
    run.onMeetingSaved(makeMeeting());
    const result = ctx.runs.saveAndFinishForClose(() => Promise.resolve());
    await flush();
    run.complete();
    await result;
    expect(ctx.spies.timers[0]!.cancelled).toBe(true);
  });
});
