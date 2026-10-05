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
    [InlineData("msedge", "Inbox - Gmail", false)]
    [InlineData("notepad", "Zoom Meeting", false)]
    public void IsMeeting_MatchesKnownCallWindows(string process, string title, bool expected)
    {
        Assert.Equal(expected, MeetingCallDetector.IsMeeting(process, title));
    }

    [Theory]
    [InlineData("chrome", "Meet - abc-defg-hij - Google Chrome")]
    [InlineData("msedge", "Meet – abc-defg-hij")]
    [InlineData("firefox", "Meet - ABC-DEFG-HIJ")]
    [InlineData("brave", "Meet - abc-defg-hij")]
    [InlineData("opera", "Meet - abc-defg-hij")]
    [InlineData("vivaldi", "Meet - abc-defg-hij")]
    public void IsMeeting_BrowserInCallMeetTab_ReturnsTrue(string process, string title)
    {
        Assert.True(MeetingCallDetector.IsMeeting(process, title));
    }

    [Theory]
    [InlineData("chrome", "Google Meet")]
    [InlineData("chrome", "Meet")]
    [InlineData("chrome", "Google Meet - Video calls and meetings for everyone")]
    [InlineData("chrome", "Standup - Google Meet")]
    [InlineData("msedge", "Andres's Personal Meeting Room - Zoom")]
    [InlineData("chrome", "Home - Microsoft Teams")]
    [InlineData("chrome", "abc-defg-hij - notes")]
    [InlineData("chrome", "Meet - abcd-efg-hij")]
    public void IsMeeting_BrowserLandingOrNonCallTab_ReturnsFalse(string process, string title)
    {
        Assert.False(MeetingCallDetector.IsMeeting(process, title));
    }
}
