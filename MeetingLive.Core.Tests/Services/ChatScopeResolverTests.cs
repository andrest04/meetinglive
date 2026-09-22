using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ChatScopeResolverTests
{
    [Fact]
    public void Resolve_Settings_HidesChatEvenWhenCaptureIsActive()
    {
        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.Settings,
            isCaptureActive: true,
            selectedFolderId: Guid.NewGuid(),
            selectedMeetingId: Guid.NewGuid());

        Assert.False(decision.IsVisible);
        Assert.Null(decision.FolderId);
        Assert.Null(decision.MeetingId);
    }

    [Fact]
    public void Resolve_WhenCaptureActive_IsLiveAndIgnoresOpenMeetingId()
    {
        var meetingId = Guid.NewGuid();

        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.Session,
            isCaptureActive: true,
            selectedFolderId: Guid.NewGuid(),
            selectedMeetingId: meetingId);

        Assert.True(decision.IsVisible);
        Assert.Equal(ChatScopeKind.Live, decision.Kind);
        Assert.Null(decision.FolderId);
        Assert.Null(decision.MeetingId);
        Assert.NotEqual(meetingId, decision.MeetingId);
    }

    [Fact]
    public void Resolve_SessionWithMeeting_IsThatMeeting()
    {
        var meetingId = Guid.NewGuid();

        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.Session,
            isCaptureActive: false,
            selectedFolderId: Guid.NewGuid(),
            selectedMeetingId: meetingId);

        Assert.True(decision.IsVisible);
        Assert.Equal(ChatScopeKind.Meeting, decision.Kind);
        Assert.Equal(meetingId, decision.MeetingId);
        Assert.Null(decision.FolderId);
    }

    [Fact]
    public void Resolve_HistoryWithFolder_IsExactFolder()
    {
        var folderId = Guid.NewGuid();

        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.History,
            isCaptureActive: false,
            selectedFolderId: folderId,
            selectedMeetingId: Guid.NewGuid());

        Assert.True(decision.IsVisible);
        Assert.Equal(ChatScopeKind.Folder, decision.Kind);
        Assert.Equal(folderId, decision.FolderId);
        Assert.Null(decision.MeetingId);
    }

    [Fact]
    public void Resolve_HistoryInbox_IsAllMeetings()
    {
        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.History,
            isCaptureActive: false,
            selectedFolderId: null,
            selectedMeetingId: Guid.NewGuid());

        Assert.True(decision.IsVisible);
        Assert.Equal(ChatScopeKind.AllMeetings, decision.Kind);
        Assert.Null(decision.FolderId);
        Assert.Null(decision.MeetingId);
    }

    [Fact]
    public void Resolve_RecordingIdle_IsAllMeetings()
    {
        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.Recording,
            isCaptureActive: false,
            selectedFolderId: Guid.NewGuid(),
            selectedMeetingId: Guid.NewGuid());

        Assert.True(decision.IsVisible);
        Assert.Equal(ChatScopeKind.AllMeetings, decision.Kind);
        Assert.Null(decision.FolderId);
        Assert.Null(decision.MeetingId);
    }

    [Fact]
    public void Resolve_SessionWithoutMeeting_IsAllMeetings()
    {
        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.Session,
            isCaptureActive: false,
            selectedFolderId: null,
            selectedMeetingId: null);

        Assert.Equal(ChatScopeKind.AllMeetings, decision.Kind);
        Assert.True(decision.IsVisible);
    }

    [Theory]
    [InlineData(ChatScopeResolver.RecordingTag, ChatShellSurface.Recording)]
    [InlineData(ChatScopeResolver.HistoryTag, ChatShellSurface.History)]
    [InlineData(ChatScopeResolver.SettingsTag, ChatShellSurface.Settings)]
    [InlineData(ChatScopeResolver.SessionTag, ChatShellSurface.Session)]
    [InlineData("Ask", ChatShellSurface.Unknown)]
    public void ParseSurface_MapsShellTags(string tag, ChatShellSurface expected)
    {
        Assert.Equal(expected, ChatScopeResolver.ParseSurface(tag));
    }

    [Fact]
    public void MatchesOpenThread_WhenScopeIdsDiffer_IsFalse()
    {
        var meetingId = Guid.NewGuid();
        var thread = Thread(ChatScopeKind.Meeting, folderId: null, meetingId);
        var other = ChatScopeResolver.Resolve(
            ChatShellSurface.Session,
            isCaptureActive: false,
            selectedFolderId: null,
            selectedMeetingId: Guid.NewGuid());

        Assert.False(ChatScopeResolver.MatchesOpenThread(thread, other));
    }

    [Fact]
    public void MatchesOpenThread_WhenScopeIdsMatch_IsTrue()
    {
        var folderId = Guid.NewGuid();
        var decision = ChatScopeResolver.Resolve(
            ChatShellSurface.History,
            isCaptureActive: false,
            selectedFolderId: folderId,
            selectedMeetingId: null);

        Assert.True(ChatScopeResolver.MatchesOpenThread(
            Thread(ChatScopeKind.Folder, folderId, meetingId: null),
            decision));
    }

    private static ChatThread Thread(ChatScopeKind kind, Guid? folderId, Guid? meetingId) => new()
    {
        Id = Guid.NewGuid(),
        Title = "Thread",
        CreatedAt = DateTimeOffset.UnixEpoch,
        UpdatedAt = DateTimeOffset.UnixEpoch,
        ScopeKind = kind,
        FolderId = folderId,
        MeetingId = meetingId,
    };
}
