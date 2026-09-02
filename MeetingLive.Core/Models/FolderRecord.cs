namespace MeetingLive.Core.Models;

/// <summary>
/// Nested Library container. Meetings are filed by <see cref="MeetingRecord.FolderId"/>;
/// folders themselves live in <c>folders.json</c>, not as directories on disk.
/// </summary>
public sealed class FolderRecord
{
    public required Guid Id { get; init; }

    public required string Name { get; set; }

    /// <summary><see langword="null"/> means a root folder (parent of Inbox is not a folder).</summary>
    public Guid? ParentId { get; set; }

    /// <summary>Optional cover note for this folder, distinct from per-session notes.</summary>
    public string? Note { get; set; }

    public required DateTimeOffset CreatedAt { get; init; }
}
