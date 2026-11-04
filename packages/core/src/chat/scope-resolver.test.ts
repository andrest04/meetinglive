import { describe, expect, it } from 'vitest';
import { Workspace } from '../library/workspace';
import {
  matchesOpenThread,
  parseSurface,
  resolveScope,
  resolveScopeFromWorkspace,
} from './scope-resolver';

const F = 'aaaaaaaa-0000-0000-0000-000000000001';
const M = 'bbbbbbbb-0000-0000-0000-000000000002';

describe('ChatScopeResolverTests', () => {
  it('Resolve_Settings_HidesChatEvenWhenCaptureIsActive', () => {
    expect(resolveScope('Settings', true, F, M)).toEqual({
      isVisible: false,
      kind: 'AllMeetings',
      folderId: null,
      meetingId: null,
    });
  });
  it('Resolve_WhenCaptureActive_IsLiveAndIgnoresOpenMeetingId', () => {
    for (const surface of ['Recording', 'History', 'Session', 'Unknown'] as const) {
      expect(resolveScope(surface, true, F, M)).toEqual({
        isVisible: true,
        kind: 'Live',
        folderId: null,
        meetingId: null,
      });
    }
  });
  it('Resolve_SessionWithMeeting_IsThatMeeting', () => {
    expect(resolveScope('Session', false, F, M)).toEqual({
      isVisible: true,
      kind: 'Meeting',
      folderId: null,
      meetingId: M,
    });
  });
  it('Resolve_HistoryWithFolder_IsExactFolder', () => {
    expect(resolveScope('History', false, F, M)).toEqual({
      isVisible: true,
      kind: 'Folder',
      folderId: F,
      meetingId: null,
    });
  });
  it('Resolve_HistoryInbox_IsAllMeetings', () => {
    expect(resolveScope('History', false, null, M).kind).toBe('AllMeetings');
  });
  it('Resolve_RecordingIdle_IsAllMeetings', () => {
    expect(resolveScope('Recording', false, F, M)).toEqual({
      isVisible: true,
      kind: 'AllMeetings',
      folderId: null,
      meetingId: null,
    });
  });
  it('Resolve_SessionWithoutMeeting_IsAllMeetings', () => {
    expect(resolveScope('Session', false, F, null).kind).toBe('AllMeetings');
    expect(resolveScope('Unknown', false, F, M).kind).toBe('AllMeetings');
  });
  it('ParseSurface_MapsShellTags', () => {
    expect(parseSurface('Recording')).toBe('Recording');
    expect(parseSurface('History')).toBe('History');
    expect(parseSurface('Settings')).toBe('Settings');
    expect(parseSurface('Session')).toBe('Session');
    for (const bad of ['recording', 'SETTINGS', ' History', '', 'Other', null, undefined]) {
      expect(parseSurface(bad)).toBe('Unknown');
    }
  });
  it('MatchesOpenThread_WhenScopeIdsDiffer_IsFalse', () => {
    const decision = resolveScope('Session', false, null, M);
    expect(matchesOpenThread({ scopeKind: 'Meeting', meetingId: 'other' }, decision)).toBe(false);
    expect(matchesOpenThread({ scopeKind: 'AllMeetings', meetingId: M }, decision)).toBe(false);
    expect(matchesOpenThread({ scopeKind: 'Meeting', folderId: F, meetingId: M }, decision)).toBe(
      false,
    );
  });
  it('MatchesOpenThread_WhenScopeIdsMatch_IsTrue', () => {
    expect(
      matchesOpenThread(
        { scopeKind: 'Meeting', folderId: null, meetingId: M },
        resolveScope('Session', false, null, M),
      ),
    ).toBe(true);
    expect(
      matchesOpenThread({ scopeKind: 'AllMeetings' }, resolveScope('Recording', false, null, null)),
    ).toBe(true);
  });

  it('resolves from the Workspace snapshot read at call time', () => {
    const ws = new Workspace();
    expect(resolveScopeFromWorkspace(ws.state).kind).toBe('AllMeetings');
    ws.setCurrentShellTag('Session');
    ws.selectMeeting(M);
    expect(resolveScopeFromWorkspace(ws.state).meetingId).toBe(M);
    ws.setCaptureActive(true);
    expect(resolveScopeFromWorkspace(ws.state).kind).toBe('Live');
  });

  it('raises scopeChanged for tag, folder, meeting and capture changes, not for live text', () => {
    const ws = new Workspace();
    let count = 0;
    ws.on('scopeChanged', () => (count += 1));
    ws.setCurrentShellTag('History');
    ws.publishSelectedFolder(null);
    ws.selectMeeting(M);
    ws.setCaptureActive(true);
    expect(count).toBe(4);
    ws.setLiveTranscript('hello');
    expect(count).toBe(4);
    expect(ws.state.liveTranscript).toBe('hello');
  });
});
