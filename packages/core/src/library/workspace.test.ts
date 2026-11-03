import { describe, expect, it, vi } from 'vitest';
import { Workspace } from './workspace';

function make() {
  const workspace = new Workspace();
  const scope = vi.fn();
  workspace.on('scopeChanged', scope);
  return { workspace, scope };
}

describe('Workspace defaults', () => {
  it('starts on Recording with the Transcript tab and nothing selected', () => {
    const { workspace } = make();
    expect(workspace.state).toEqual({
      selectedMeetingId: null,
      lastProcessedMeetingId: null,
      sessionTab: 'Transcript',
      currentShellTag: 'Recording',
      selectedFolderId: null,
      liveTranscript: '',
      isCaptureActive: false,
    });
  });
});

describe('Workspace ScopeChanged', () => {
  it('fires for a different shell tag only', () => {
    const { workspace, scope } = make();
    workspace.setCurrentShellTag('Recording');
    expect(scope).not.toHaveBeenCalled();
    workspace.setCurrentShellTag('History');
    expect(scope).toHaveBeenCalledTimes(1);
  });

  it('fires for every folder publish, even the same folder', () => {
    const { workspace, scope } = make();
    workspace.publishSelectedFolder('f');
    workspace.publishSelectedFolder('f');
    expect(scope).toHaveBeenCalledTimes(2);
  });

  it('fires for a different selected meeting only', () => {
    const { workspace, scope } = make();
    workspace.selectMeeting('m');
    workspace.selectMeeting('m');
    expect(scope).toHaveBeenCalledTimes(1);
  });

  it('fires for a different capture flag only, and never for transcript text alone', () => {
    const { workspace, scope } = make();
    workspace.setCaptureActive(false);
    workspace.setLiveTranscript('hello');
    expect(scope).not.toHaveBeenCalled();
    workspace.setCaptureActive(true);
    expect(scope).toHaveBeenCalledTimes(1);
    expect(workspace.state.liveTranscript).toBe('hello');
  });
});

describe('Workspace validation', () => {
  it('rejects unknown shell tags', () => {
    const { workspace } = make();
    expect(() => workspace.setCurrentShellTag('Nope' as never)).toThrow();
    expect(() => workspace.setCurrentShellTag('Transcript' as never)).toThrow();
  });

  it('NavigateTo rejects session tabs and unknown tags', () => {
    const { workspace } = make();
    expect(() => workspace.navigateTo('Transcript' as never)).toThrow();
    expect(() => workspace.navigateTo('Summary' as never)).toThrow();
    expect(() => workspace.navigateTo('Nope' as never)).toThrow();
  });

  it('SetSessionTab accepts only Transcript and Summary', () => {
    const { workspace } = make();
    workspace.setSessionTab('Summary');
    expect(workspace.state.sessionTab).toBe('Summary');
    expect(() => workspace.setSessionTab('History' as never)).toThrow();
  });

  it('NavigateTo raises a request and leaves the tag to the shell', () => {
    const { workspace } = make();
    const requested = vi.fn();
    workspace.on('navigationRequested', requested);
    workspace.navigateTo('Settings');
    expect(requested).toHaveBeenCalledWith('Settings');
    expect(workspace.state.currentShellTag).toBe('Recording');
  });

  it('OpenSession sets the tab then navigates to Session', () => {
    const { workspace } = make();
    const requested = vi.fn();
    workspace.on('navigationRequested', requested);
    workspace.openSession('Summary');
    expect(workspace.state.sessionTab).toBe('Summary');
    expect(requested).toHaveBeenCalledWith('Session');
  });
});

describe('Workspace selection', () => {
  it('SetLastProcessed stores the record and selects it', () => {
    const { workspace } = make();
    workspace.setLastProcessed('m1');
    expect(workspace.state.lastProcessedMeetingId).toBe('m1');
    expect(workspace.state.selectedMeetingId).toBe('m1');
  });

  it('ClearSelection clears last processed only when it is the selection', () => {
    const { workspace } = make();
    workspace.setLastProcessed('m1');
    workspace.selectMeeting('m2');
    workspace.clearSelection();
    expect(workspace.state.lastProcessedMeetingId).toBe('m1');
    expect(workspace.state.selectedMeetingId).toBeNull();
    workspace.setLastProcessed('m1');
    workspace.clearSelection();
    expect(workspace.state.lastProcessedMeetingId).toBeNull();
  });

  it('NotifyDeleted clears matches and raises MeetingDeleted', () => {
    const { workspace } = make();
    const deleted = vi.fn();
    workspace.on('meetingDeleted', deleted);
    workspace.setLastProcessed('m1');
    workspace.notifyDeleted('m1');
    expect(workspace.state.lastProcessedMeetingId).toBeNull();
    expect(workspace.state.selectedMeetingId).toBeNull();
    expect(deleted).toHaveBeenCalledWith('m1');

    workspace.selectMeeting('m2');
    workspace.notifyDeleted('other');
    expect(workspace.state.selectedMeetingId).toBe('m2');
  });

  it('NotifyMeetingChanged raises MeetingChanged', () => {
    const { workspace } = make();
    const changed = vi.fn();
    workspace.on('meetingChanged', changed);
    workspace.notifyMeetingChanged('m1');
    expect(changed).toHaveBeenCalledWith('m1');
  });
});

describe('Workspace take-notes request', () => {
  it('stores a blank-normalized event id, raises the event, then navigates to Recording', () => {
    const { workspace } = make();
    const order: string[] = [];
    workspace.on('takeNotesRequested', () => order.push('requested'));
    workspace.on('navigationRequested', (tag) => order.push(`nav:${tag}`));
    workspace.requestTakeNotes('  ');
    expect(order).toEqual(['requested', 'nav:Recording']);
    expect(workspace.consumeTakeNotes()).toEqual({ pending: true, calendarEventId: null });
  });

  it('consume returns the pending flag once and clears everything', () => {
    const { workspace } = make();
    workspace.requestTakeNotes('evt-1');
    expect(workspace.consumeTakeNotes()).toEqual({ pending: true, calendarEventId: 'evt-1' });
    expect(workspace.consumeTakeNotes()).toEqual({ pending: false, calendarEventId: null });
  });

  it('OfferCallPrompt raises CallPromptOffered', () => {
    const { workspace } = make();
    const offered = vi.fn();
    workspace.on('callPromptOffered', offered);
    workspace.offerCallPrompt();
    expect(offered).toHaveBeenCalledTimes(1);
  });

  it('an unsubscribed listener is not called', () => {
    const { workspace } = make();
    const listener = vi.fn();
    const off = workspace.on('meetingChanged', listener);
    off();
    workspace.notifyMeetingChanged('x');
    expect(listener).not.toHaveBeenCalled();
  });
});
