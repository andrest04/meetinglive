using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingCallDetectorTests
{
    [Theory]
    [InlineData("CptHost", "Zoom", true)]
    [InlineData("zoom", "Zoom Meeting", true)]
    [InlineData("Zoom", "Zoom Workplace", false)]
    [InlineData("ms-teams", "Standup | Meeting", true)]
    [InlineData("Teams", "Chat | Microsoft Teams", false)]
    [InlineData("chrome", "Standup - Google Meet", true)]
    [InlineData("chrome", "Andres's Personal Meeting Room - Zoom", true)]
    [InlineData("msedge", "Inbox - Gmail", false)]
    [InlineData("notepad", "Zoom Meeting", false)]
    public void IsMeeting_MatchesKnownCallWindows(string process, string title, bool expected)
    {
        Assert.Equal(expected, MeetingCallDetector.IsMeeting(process, title));
    }
}
