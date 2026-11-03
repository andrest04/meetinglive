import { describe, expect, it } from 'vitest';
import { isMeeting } from './call-detector';

describe('isMeeting', () => {
  it.each([
    ['CptHost', 'Zoom', true],
    ['cpthost', '', true],
    ['zoom', 'Zoom Meeting', true],
    ['zoom', 'Zoom Webinar', true],
    ['Zoom', 'Zoom Workplace', false],
    ['ms-teams', 'Standup | Meeting', true],
    ['Teams', 'Chat | Microsoft Teams', false],
    ['msedge', 'Inbox - Gmail', false],
    ['notepad', 'Zoom Meeting', false],
    ['', 'Zoom Meeting', false],
    ['   ', 'Zoom Meeting', false],
    ['  ZOOM  ', 'zoom meeting', true],
  ])('%s / %s -> %s', (proc, title, expected) => {
    expect(isMeeting(proc, title)).toBe(expected);
  });

  it.each([
    ['chrome', 'Meet - abc-defg-hij - Google Chrome'],
    ['msedge', 'Meet \u2013 abc-defg-hij'],
    ['firefox', 'Meet - ABC-DEFG-HIJ'],
    ['brave', 'Meet - abc-defg-hij'],
    ['opera', 'Meet - abc-defg-hij'],
    ['vivaldi', 'Meet - abc-defg-hij'],
  ])('%s in-call title is a meeting', (proc, title) => {
    expect(isMeeting(proc, title)).toBe(true);
  });

  it.each([
    ['chrome', 'Google Meet'],
    ['chrome', 'Meet'],
    ['chrome', 'Google Meet - Video calls and meetings for everyone'],
    ['chrome', 'Standup - Google Meet'],
    ['msedge', "Andres's Personal Meeting Room - Zoom"],
    ['chrome', 'Home - Microsoft Teams'],
    ['chrome', 'abc-defg-hij - notes'],
    ['chrome', 'Meet - abcd-efg-hij'],
  ])('%s title "%s" is not a meeting', (proc, title) => {
    expect(isMeeting(proc, title)).toBe(false);
  });

  // B8: C# matched the substring "Call", so a Teams "Calls" tab counted as a call.
  it('B8: a Teams window titled Calls or Meetings is not a call', () => {
    expect(isMeeting('ms-teams', 'Calls | Microsoft Teams')).toBe(false);
    expect(isMeeting('Teams', 'Meetings | Microsoft Teams')).toBe(false);
  });

  it('B8: a Teams window with the word Call or Meeting still counts', () => {
    expect(isMeeting('ms-teams', 'Call with Ana | Microsoft Teams')).toBe(true);
    expect(isMeeting('teams', 'Weekly MEETING | Microsoft Teams')).toBe(true);
  });

  it('B8 kept: webex, slack, discord and skype are never detected', () => {
    for (const p of ['webex', 'slack', 'discord', 'skype']) {
      expect(isMeeting(p, 'Meeting call')).toBe(false);
    }
  });
});
