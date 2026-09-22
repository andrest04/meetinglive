namespace MeetingLive.Core.Models;

/// <summary>Where a chat thread is allowed to look for meeting notes.</summary>
public enum ChatScopeKind
{
    AllMeetings,
    Folder,
    Meeting,
    Live,
}
