using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>One row in a flattened Library path list. Inbox is <see cref="FolderId"/> null.</summary>
public sealed record FolderPathItem(Guid? FolderId, string Path);

/// <summary>
/// Flattens nested <see cref="FolderRecord"/> trees into Inbox-first path rows
/// so Record and Library share one walk.
/// </summary>
public static class FolderPathList
{
    public static IReadOnlyList<FolderPathItem> Flatten(IReadOnlyList<FolderRecord> folders, string inboxLabel)
    {
        ArgumentNullException.ThrowIfNull(folders);
        ArgumentException.ThrowIfNullOrWhiteSpace(inboxLabel);

        var result = new List<FolderPathItem>
        {
            new(null, inboxLabel),
        };

        void Walk(Guid? parentId, string prefix)
        {
            foreach (var folder in folders
                .Where(item => item.ParentId == parentId)
                .OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase))
            {
                var path = string.IsNullOrEmpty(prefix) ? folder.Name : prefix + " / " + folder.Name;
                result.Add(new FolderPathItem(folder.Id, path));
                Walk(folder.Id, path);
            }
        }

        Walk(null, string.Empty);
        return result;
    }
}
