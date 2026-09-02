using System.Collections.ObjectModel;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// One Library tree node. Inbox is virtual (<see cref="FolderId"/> is null and is not persisted).
/// </summary>
public sealed class FolderNode
{
    public Guid? FolderId { get; init; }

    public required string Name { get; init; }

    public ObservableCollection<FolderNode> Children { get; } = [];
}

public sealed class LibraryBreadcrumbItem
{
    public Guid? FolderId { get; init; }

    public required string Name { get; init; }

    public override string ToString() => Name;
}

public sealed class FolderDestination
{
    public Guid? FolderId { get; init; }

    public required string Path { get; init; }

    public override string ToString() => Path;
}
