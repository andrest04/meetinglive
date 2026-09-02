using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MarkdownMeetingRepositoryTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    [Fact]
    public async Task SaveAsync_WithDirectoryOverride_DoesNotWriteToAppPaths()
    {
        var id = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);

        await repo.SaveAsync(CreateRecord(id, AudioPath(id)));

        Assert.True(File.Exists(Path.Combine(_tempDirectory, $"{id}.md")));
        Assert.False(File.Exists(Path.Combine(AppPaths.MeetingsDirectory, $"{id}.md")));
    }

    [Fact]
    public async Task DeleteAsync_ExistingMeeting_DeletesMarkdownAndWav()
    {
        var id = Guid.NewGuid();
        var wavPath = AudioPath(id);
        Directory.CreateDirectory(_tempDirectory);
        await File.WriteAllTextAsync(wavPath, "wav");
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        await repo.SaveAsync(CreateRecord(id, wavPath));

        await repo.DeleteAsync(id);

        Assert.False(File.Exists(Path.Combine(_tempDirectory, $"{id}.md")));
        Assert.False(File.Exists(wavPath));
        Assert.Null(await repo.GetByIdAsync(id));
    }

    [Fact]
    public async Task DeleteAsync_WhenMeetingAlreadyGone_DoesNotThrow()
    {
        var repo = new MarkdownMeetingRepository(_tempDirectory);

        var exception = await Record.ExceptionAsync(() => repo.DeleteAsync(Guid.NewGuid()));

        Assert.Null(exception);
    }

    [Fact]
    public async Task DeleteAsync_WhenWavMissing_StillDeletesMarkdown()
    {
        var id = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        await repo.SaveAsync(CreateRecord(id, AudioPath(id)));

        await repo.DeleteAsync(id);

        Assert.False(File.Exists(Path.Combine(_tempDirectory, $"{id}.md")));
    }

    [Fact]
    public async Task DeleteAsync_DoesNotRewriteSiblingMeetings()
    {
        var keptId = Guid.NewGuid();
        var deletedId = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        await repo.SaveAsync(CreateRecord(keptId, AudioPath(keptId), "Keep me"));
        await repo.SaveAsync(CreateRecord(deletedId, AudioPath(deletedId), "Delete me"));
        var keptPath = Path.Combine(_tempDirectory, $"{keptId}.md");
        var original = await File.ReadAllTextAsync(keptPath);
        var originalWriteTime = File.GetLastWriteTimeUtc(keptPath);

        await repo.DeleteAsync(deletedId);

        Assert.Equal(original, await File.ReadAllTextAsync(keptPath));
        Assert.Equal(originalWriteTime, File.GetLastWriteTimeUtc(keptPath));
        var remaining = await repo.GetAllAsync();
        Assert.Single(remaining);
        Assert.Equal(keptId, remaining[0].Id);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    private string AudioPath(Guid id) => Path.Combine(_tempDirectory, $"{id}.wav");

    private static MeetingRecord CreateRecord(Guid id, string audioPath, string title = "Standup") => new()
    {
        Id = id,
        Title = title,
        RecordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
        AudioFilePath = audioPath,
        Transcript = "hello",
        Summary = "### Notes\nHello",
    };
}
