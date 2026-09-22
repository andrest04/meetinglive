namespace MeetingLive.Core.Models;

/// <summary>One turn in a private chat thread. Nothing here is sent or posted.</summary>
public sealed class ChatMessage
{
    public const string UserRole = "user";
    public const string AssistantRole = "assistant";

    public required Guid Id { get; init; }

    /// <summary><see cref="UserRole"/> or <see cref="AssistantRole"/>.</summary>
    public required string Role { get; init; }

    public required string Text { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }
}
