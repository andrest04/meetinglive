using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingLibraryLayoutTests
{
    [Fact]
    public void DirectoryFor_WhenFolderIdIsNull_ReturnsInbox()
    {
        var root = Path.Combine(Path.GetTempPath(), "lib");

        var path = MeetingLibraryLayout.DirectoryFor(root, [], null);

        Assert.Equal(Path.Combine(root, "Inbox"), path);
    }

    [Fact]
    public void DirectoryFor_NestedFolder_JoinsSanitizedNames()
    {
        var root = Path.Combine(Path.GetTempPath(), "lib");
        var universidad = new FolderRecord
        {
            Id = Guid.NewGuid(),
            Name = "Universidad",
            CreatedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
        };
        var week = new FolderRecord
        {
            Id = Guid.NewGuid(),
            Name = "Semana 1",
            ParentId = universidad.Id,
            CreatedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
        };

        var path = MeetingLibraryLayout.DirectoryFor(root, [universidad, week], week.Id);

        Assert.Equal(Path.Combine(root, "Universidad", "Semana 1"), path);
    }

    [Fact]
    public void FileStem_UsesOffsetDateAndSanitizedTitle()
    {
        var recordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z");

        var stem = MeetingLibraryLayout.FileStem(recordedAt, "Standup: Q2?");

        Assert.Equal("2026-09-01 Standup Q2", stem);
    }

    [Fact]
    public void SanitizeName_WhenReservedInbox_ReturnsInboxFolder()
    {
        Assert.Equal("Inbox folder", MeetingLibraryLayout.SanitizeName("Inbox"));
    }
}
