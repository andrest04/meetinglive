namespace MeetingLive_App.ViewModels;

public sealed class ChatMessageItem
{
    public required Guid Id { get; init; }

    public required string Role { get; init; }

    public required string Text { get; init; }

    public required string RoleLabel { get; init; }

    public bool IsAssistant { get; init; }
}

public sealed class ChatThreadItem
{
    public required Guid Id { get; init; }

    public required string Title { get; init; }

    public required string UpdatedLabel { get; init; }
}

public sealed class ChatRecipeItem
{
    public required Guid Id { get; init; }

    public required string Name { get; init; }

    public required string Prompt { get; init; }

    public required bool IsBuiltIn { get; init; }

    public bool CanDelete => !IsBuiltIn;
}
