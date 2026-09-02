using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class JsonFolderRepositoryTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());
    private string TempFilePath => Path.Combine(_tempDirectory, "folders.json");

    [Fact]
    public async Task SaveAsync_WithPathOverride_DoesNotWriteToAppPaths()
    {
        var id = Guid.NewGuid();
        var repo = new JsonFolderRepository(TempFilePath);

        await repo.SaveAsync(CreateFolder(id, "Universidad"));

        Assert.True(File.Exists(TempFilePath));
        if (File.Exists(AppPaths.FoldersFilePath))
        {
            var real = await File.ReadAllTextAsync(AppPaths.FoldersFilePath);
            Assert.DoesNotContain(id.ToString(), real, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task SaveAsync_ThenGetByIdAsync_RoundtripsFolder()
    {
        var id = Guid.NewGuid();
        var parentId = Guid.NewGuid();
        var repo = new JsonFolderRepository(TempFilePath);
        var folder = CreateFolder(id, "Semana 1", parentId, "Cover note");

        await repo.SaveAsync(folder);
        var loaded = await repo.GetByIdAsync(id);

        Assert.NotNull(loaded);
        Assert.Equal(id, loaded.Id);
        Assert.Equal("Semana 1", loaded.Name);
        Assert.Equal(parentId, loaded.ParentId);
        Assert.Equal("Cover note", loaded.Note);
        Assert.Equal(folder.CreatedAt, loaded.CreatedAt);
    }

    [Fact]
    public async Task SaveAsync_ExistingId_Upserts()
    {
        var id = Guid.NewGuid();
        var repo = new JsonFolderRepository(TempFilePath);
        await repo.SaveAsync(CreateFolder(id, "Old name"));

        var updated = CreateFolder(id, "New name", note: "Updated");
        await repo.SaveAsync(updated);
        var loaded = await repo.GetByIdAsync(id);
        var all = await repo.GetAllAsync();

        Assert.NotNull(loaded);
        Assert.Equal("New name", loaded.Name);
        Assert.Equal("Updated", loaded.Note);
        Assert.Single(all);
    }

    [Fact]
    public async Task DeleteAsync_ExistingFolder_RemovesIt()
    {
        var id = Guid.NewGuid();
        var repo = new JsonFolderRepository(TempFilePath);
        await repo.SaveAsync(CreateFolder(id, "Temp"));

        await repo.DeleteAsync(id);

        Assert.Null(await repo.GetByIdAsync(id));
        Assert.Empty(await repo.GetAllAsync());
    }

    [Fact]
    public async Task DeleteAsync_WhenFolderAlreadyGone_DoesNotThrow()
    {
        var repo = new JsonFolderRepository(TempFilePath);

        var exception = await Record.ExceptionAsync(() => repo.DeleteAsync(Guid.NewGuid()));

        Assert.Null(exception);
        Assert.False(File.Exists(TempFilePath));
    }

    [Fact]
    public async Task GetAllAsync_WhenFileMissing_ReturnsEmpty()
    {
        var repo = new JsonFolderRepository(TempFilePath);

        var folders = await repo.GetAllAsync();

        Assert.Empty(folders);
        Assert.False(File.Exists(TempFilePath));
        Assert.False(Directory.Exists(_tempDirectory));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    private static FolderRecord CreateFolder(
        Guid id,
        string name,
        Guid? parentId = null,
        string? note = null) => new()
    {
        Id = id,
        Name = name,
        ParentId = parentId,
        Note = note,
        CreatedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
    };
}
