namespace MeetingLive_App.ViewModels;

public sealed class ChatMessageItem
{
    public required Guid Id { get; init; }

    public required string Role { get; init; }

    public required string Text { get; init; }

    public required string RoleLabel { get; init; }

    public bool IsAssistant { get; init; }

    public bool IsPending { get; init; }

    public bool IsUser => !IsAssistant;

    public bool HasAnswer => IsAssistant && !IsPending;

    // ListViewItem automation peers read the item's ToString.
    public override string ToString() => IsPending ? RoleLabel : $"{RoleLabel}: {Text}";
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
