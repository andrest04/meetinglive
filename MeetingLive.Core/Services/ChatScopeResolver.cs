using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pure chat-scope decision. Tag strings match the shell navigation tags
/// (<c>Recording</c>, <c>History</c>, <c>Settings</c>, <c>Session</c>).
/// Settings hides chat. Capture wins over an open meeting. Inbox (null folder) is all meetings.
/// </summary>
public static class ChatScopeResolver
{
    public const string RecordingTag = "Recording";
    public const string HistoryTag = "History";
    public const string SettingsTag = "Settings";
    public const string SessionTag = "Session";

    public static ChatShellSurface ParseSurface(string? tag) => tag switch
    {
        RecordingTag => ChatShellSurface.Recording,
        HistoryTag => ChatShellSurface.History,
        SettingsTag => ChatShellSurface.Settings,
        SessionTag => ChatShellSurface.Session,
        _ => ChatShellSurface.Unknown,
    };

    public static ChatScopeDecision Resolve(
        ChatShellSurface surface,
        bool isCaptureActive,
        Guid? selectedFolderId,
        Guid? selectedMeetingId)
    {
        if (surface == ChatShellSurface.Settings)
            return new ChatScopeDecision(false, ChatScopeKind.AllMeetings, null, null);

        if (isCaptureActive)
            return new ChatScopeDecision(true, ChatScopeKind.Live, null, null);

        if (surface == ChatShellSurface.Session && selectedMeetingId is { } meetingId)
            return new ChatScopeDecision(true, ChatScopeKind.Meeting, null, meetingId);

        if (surface == ChatShellSurface.History && selectedFolderId is { } folderId)
            return new ChatScopeDecision(true, ChatScopeKind.Folder, folderId, null);

        return new ChatScopeDecision(true, ChatScopeKind.AllMeetings, null, null);
    }

    /// <summary>
    /// True when an open thread can accept another turn in <paramref name="decision"/>.
    /// A mismatch means the next send must start a new thread instead of mixing contexts.
    /// </summary>
    public static bool MatchesOpenThread(ChatThread thread, ChatScopeDecision decision)
    {
        ArgumentNullException.ThrowIfNull(thread);
        return thread.ScopeKind == decision.Kind
            && thread.FolderId == decision.FolderId
            && thread.MeetingId == decision.MeetingId;
    }
}

public enum ChatShellSurface
{
    Unknown,
    Recording,
    History,
    Settings,
    Session,
}

public readonly record struct ChatScopeDecision(
    bool IsVisible,
    ChatScopeKind Kind,
    Guid? FolderId,
    Guid? MeetingId);
