import { describe, expect, it, vi } from 'vitest';
import { InMemoryMeetingRepository } from '../library/in-memory-library';
import type { MeetingRecord } from '../library/meeting';
import { Workspace } from '../library/workspace';
import {
  busyReason,
  canRename,
  canRetranscribe,
  canSubmitRename,
  copyCommand,
  createCopyFeedback,
  createSlideTracker,
  deriveSessionView,
  initialTabAfterTake,
  isSessionTab,
  renameMeeting,
  resolveRevealTarget,
  slideDirection,
  type TimerPort,
} from './index';

function record(over: Partial<MeetingRecord> = {}): MeetingRecord {
  return {
    id: 'm1',
    title: 'Weekly',
    recordedAt: '2026-01-01T10:00:00.0000000+00:00',
    endedAt: null,
    audioFilePath: 'C:\\a\\m1.wav',
    sourcePath: 'C:\\a\\m1.md',
    folderId: null,
    summaryProvider: null,
    calendarEventId: null,
    calendarId: null,
    seriesId: null,
    joinUrl: null,
    noteTemplateId: null,
    attendees: [],
    brief: null,
    transcript: 'hello',
    summary: null,
    actionItems: [],
    jevAnalysis: null,
    notes: null,
    followUp: null,
    projectPlan: null,
    ...over,
  };
}

const exists = () => true;
const missing = () => false;

describe('deriveSessionView', () => {
  it('gives an empty view for a missing record', () => {
    expect(deriveSessionView(null, exists)).toEqual({
      title: '',
      hasMeeting: false,
      hasTranscript: false,
      hasAudio: false,
    });
  });

  it('reads title, transcript and audio from the record', () => {
    expect(deriveSessionView(record(), exists)).toEqual({
      title: 'Weekly',
      hasMeeting: true,
      hasTranscript: true,
      hasAudio: true,
    });
  });

  it.each([null, '', '  \r\n\t '])('hasTranscript is false for %j', (transcript) => {
    expect(deriveSessionView(record({ transcript }), exists).hasTranscript).toBe(false);
  });

  it('hasAudio needs a non-blank path and an existing file', () => {
    expect(deriveSessionView(record(), missing).hasAudio).toBe(false);
    const probe = vi.fn(() => true);
    expect(deriveSessionView(record({ audioFilePath: '  ' }), probe).hasAudio).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('busy and availability', () => {
  const idle = { isRunning: false, meetingId: null };
  const running = (id: string) => ({ isRunning: true, meetingId: id });
  const view = { hasMeeting: true, hasAudio: true };

  function ws(capture: boolean): Workspace {
    const w = new Workspace();
    w.setCaptureActive(capture);
    return w;
  }

  it('busyReason: capture, run or null (B16)', () => {
    expect(busyReason(idle, ws(false))).toBeNull();
    expect(busyReason(running('x'), ws(false))).toBe('run');
    expect(busyReason(idle, ws(true))).toBe('capture');
    expect(busyReason(running('x'), ws(true))).toBe('capture');
  });

  it('canRetranscribe truth table', () => {
    for (const hasMeeting of [true, false])
      for (const hasAudio of [true, false])
        for (const reason of [null, 'run', 'capture'] as const)
          expect(canRetranscribe({ hasMeeting, hasAudio }, reason)).toBe(
            hasMeeting && hasAudio && reason === null,
          );
  });

  it('a run on another meeting blocks re-transcribe but not rename', () => {
    expect(canRetranscribe(view, busyReason(running('other'), ws(false)))).toBe(false);
    expect(canRename(view, 'm1', running('other'))).toBe(true);
  });

  it('canRename is blocked while a run targets this meeting (B4)', () => {
    expect(canRename(view, 'm1', running('m1'))).toBe(false);
    expect(canRename(view, 'm1', idle)).toBe(true);
    expect(canRename({ hasMeeting: false }, null, idle)).toBe(false);
  });
});

describe('renameMeeting', () => {
  function setup(run = { isRunning: false, meetingId: null as string | null }) {
    const meetings = new InMemoryMeetingRepository();
    meetings.records.set('m1', record());
    const workspace = new Workspace();
    const changed = vi.fn();
    workspace.on('meetingChanged', changed);
    const save = vi.spyOn(meetings, 'save');
    const deps = { meetings, workspace, runnerState: () => run };
    return { meetings, changed, save, deps };
  }

  it('trims, saves the whole record and raises meetingChanged (B11)', async () => {
    const { meetings, changed, save, deps } = setup();
    expect(await renameMeeting(deps, 'm1', '  New name  ')).toBe('renamed');
    expect(save).toHaveBeenCalledTimes(1);
    expect(meetings.records.get('m1')).toEqual(record({ title: 'New name' }));
    expect(changed).toHaveBeenCalledExactlyOnceWith('m1');
  });

  it('same title is a no-op without save or event', async () => {
    const { changed, save, deps } = setup();
    expect(await renameMeeting(deps, 'm1', ' Weekly ')).toBe('unchanged');
    expect(save).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('blank text, no id or unknown record is missing', async () => {
    const { save, deps } = setup();
    expect(await renameMeeting(deps, 'm1', '   ')).toBe('missing');
    expect(await renameMeeting(deps, null, 'x')).toBe('missing');
    expect(await renameMeeting(deps, '', 'x')).toBe('missing');
    expect(await renameMeeting(deps, 'zzz', 'x')).toBe('missing');
    expect(save).not.toHaveBeenCalled();
  });

  it('is blocked while a run targets the meeting, allowed for others (B4)', async () => {
    const blocked = setup({ isRunning: true, meetingId: 'm1' });
    expect(await renameMeeting(blocked.deps, 'm1', 'x')).toBe('blocked');
    expect(blocked.save).not.toHaveBeenCalled();
    const other = setup({ isRunning: true, meetingId: 'zz' });
    expect(await renameMeeting(other.deps, 'm1', 'x')).toBe('renamed');
  });

  it('canSubmitRename requires a non-blank name', () => {
    expect(canSubmitRename('a')).toBe(true);
    expect(canSubmitRename('  ')).toBe(false);
    expect(canSubmitRename('')).toBe(false);
  });
});

describe('copy', () => {
  it('copyCommand returns text or null', () => {
    expect(copyCommand('hi')).toBe('hi');
    expect(copyCommand('  hi ')).toBe('  hi ');
    for (const v of [null, undefined, '', '  \n'] as const) expect(copyCommand(v)).toBeNull();
  });

  /** Manual clock: tasks fire when advanceTimersByTime passes their due time. */
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { due: number; task: () => void }>();
  const vi2 = {
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.due <= now) {
          pending.delete(id);
          t.task();
        }
      }
    },
  };
  const timerPort: TimerPort = {
    setTimeout(task, ms) {
      const id = nextId++;
      pending.set(id, { due: now + ms, task });
      return id;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
  };
  const fakeTimers = () => {
    now = 0;
    pending.clear();
    return timerPort;
  };

  it('shows for 2500 ms then hides', () => {
    const feedback = createCopyFeedback(fakeTimers());
    const seen: boolean[] = [];
    feedback.subscribe((v) => seen.push(v));
    feedback.show();
    expect(feedback.visible).toBe(true);
    vi2.advance(2499);
    expect(feedback.visible).toBe(true);
    vi2.advance(1);
    expect(feedback.visible).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('a new copy restarts the timer', () => {
    const feedback = createCopyFeedback(fakeTimers());
    feedback.show();
    vi2.advance(2000);
    feedback.show();
    vi2.advance(2000);
    expect(feedback.visible).toBe(true);
    vi2.advance(500);
    expect(feedback.visible).toBe(false);
  });

  it('manual dismiss hides at once and cancels the timer', () => {
    const feedback = createCopyFeedback(fakeTimers());
    const listener = vi.fn();
    feedback.show();
    feedback.subscribe(listener);
    feedback.dismiss();
    expect(feedback.visible).toBe(false);
    vi2.advance(5000);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('tabs', () => {
  it('slideDirection: higher index from the right, otherwise left', () => {
    expect(slideDirection(0, 1)).toBe('FromRight');
    expect(slideDirection(1, 0)).toBe('FromLeft');
    expect(slideDirection(1, 1)).toBe('FromLeft');
  });

  it('tracks the previous index on every navigation, starting at the opened tab (B15)', () => {
    const summaryFirst = createSlideTracker('Summary');
    expect(summaryFirst.navigate('Summary')).toBe('FromLeft');
    expect(summaryFirst.navigate('Transcript')).toBe('FromLeft');
    expect(summaryFirst.navigate('Summary')).toBe('FromRight');
    const t = createSlideTracker('Transcript');
    expect(t.navigate('Summary')).toBe('FromRight');
    expect(t.navigate('Summary')).toBe('FromLeft');
  });

  it('isSessionTab accepts only the two names', () => {
    expect(isSessionTab('Transcript')).toBe(true);
    expect(isSessionTab('Summary')).toBe(true);
    for (const v of ['summary', 'Notes', '', null, 1]) expect(isSessionTab(v)).toBe(false);
  });

  it('initialTabAfterTake', () => {
    expect(initialTabAfterTake(true)).toBe('Summary');
    expect(initialTabAfterTake(false)).toBe('Transcript');
  });
});

describe('resolveRevealTarget', () => {
  it('returns the path when the file exists', () => {
    expect(resolveRevealTarget(record(), exists)).toBe('C:\\a\\m1.md');
  });
  it('returns null for no record, blank path or missing file', () => {
    expect(resolveRevealTarget(null, exists)).toBeNull();
    expect(resolveRevealTarget(record({ sourcePath: null }), exists)).toBeNull();
    expect(resolveRevealTarget(record({ sourcePath: '  ' }), exists)).toBeNull();
    expect(resolveRevealTarget(record(), missing)).toBeNull();
  });
});
