using CommunityToolkit.Mvvm.ComponentModel;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// One transcript row. <see cref="Text"/> and <see cref="IsPending"/> change while an
/// assistant answer streams into the pending row; persisted rows never change.
/// </summary>
public sealed partial class ChatMessageItem : ObservableObject
{
    public required Guid Id { get; init; }

    public required string Role { get; init; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasText))]
    [NotifyPropertyChangedFor(nameof(IsThinking))]
    private string _text = string.Empty;

    public required string RoleLabel { get; init; }

    public bool IsAssistant { get; init; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasAnswer))]
    [NotifyPropertyChangedFor(nameof(IsThinking))]
    private bool _isPending;

    public bool IsUser => !IsAssistant;

    /// <summary>Completed assistant answer (copy button).</summary>
    public bool HasAnswer => IsAssistant && !IsPending;

    /// <summary>Assistant text to render, including a partially streamed answer.</summary>
    public bool HasText => IsAssistant && Text.Length > 0;

    /// <summary>Pending answer with no streamed text yet.</summary>
    public bool IsThinking => IsPending && Text.Length == 0;

    // ListViewItem automation peers read the item's ToString.
    public override string ToString() => IsThinking ? RoleLabel : $"{RoleLabel}: {Text}";
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
