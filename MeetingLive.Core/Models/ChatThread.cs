namespace MeetingLive.Core.Models;

/// <summary>A private multi-turn chat. Persisted under %LOCALAPPDATA%\MeetingLive, not Documents.</summary>
public sealed class ChatThread
{
    public required Guid Id { get; init; }

    public required string Title { get; set; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; set; }

    public required ChatScopeKind ScopeKind { get; set; }

    public Guid? FolderId { get; set; }

    public Guid? MeetingId { get; set; }

    public List<ChatMessage> Messages { get; set; } = [];
}
