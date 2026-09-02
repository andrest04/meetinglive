using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class FolderPathListTests
{
    [Fact]
    public void Flatten_EmptyFolders_InboxFirst()
    {
        var result = FolderPathList.Flatten([], "Inbox");

        Assert.Single(result);
        Assert.Null(result[0].FolderId);
        Assert.Equal("Inbox", result[0].Path);
    }

    [Fact]
    public void Flatten_RootFolders_ListsInboxThenSortedRoots()
    {
        var biology = CreateFolder("Biology");
        var astronomy = CreateFolder("Astronomy");

        var result = FolderPathList.Flatten([biology, astronomy], "Inbox");

        Assert.Equal(3, result.Count);
        Assert.Equal("Inbox", result[0].Path);
        Assert.Null(result[0].FolderId);
        Assert.Equal("Astronomy", result[1].Path);
        Assert.Equal(astronomy.Id, result[1].FolderId);
        Assert.Equal("Biology", result[2].Path);
        Assert.Equal(biology.Id, result[2].FolderId);
    }

    [Fact]
    public void Flatten_NestedFolders_JoinsNamesWithSlash()
    {
        var university = CreateFolder("University");
        var physics = CreateFolder("Physics", university.Id);
        var week = CreateFolder("Week 1", physics.Id);

        var result = FolderPathList.Flatten([week, university, physics], "Inbox");

        Assert.Equal(4, result.Count);
        Assert.Equal("Inbox", result[0].Path);
        Assert.Equal("University", result[1].Path);
        Assert.Equal("University / Physics", result[2].Path);
        Assert.Equal(physics.Id, result[2].FolderId);
        Assert.Equal("University / Physics / Week 1", result[3].Path);
        Assert.Equal(week.Id, result[3].FolderId);
    }

    private static FolderRecord CreateFolder(string name, Guid? parentId = null) => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        ParentId = parentId,
        CreatedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
    };
}
