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

        Assert.True(File.Exists(InboxMarkdownPath("Standup")));
        Assert.False(File.Exists(Path.Combine(AppPaths.UserDataDirectory, $"{id}.md")));
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

        Assert.False(File.Exists(InboxMarkdownPath("Standup")));
        Assert.False(File.Exists(InboxAudioPath("Standup")));
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

        Assert.False(File.Exists(InboxMarkdownPath("Standup")));
    }

    [Fact]
    public async Task SaveAsync_WhenSummaryContainsMarkdownH2_RoundtripsFullSummary()
    {
        var id = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        var summary = "### Notes\nHello\n\n## Decisions\nShip it\n\n## Risks\nNone";
        var record = CreateRecord(id, AudioPath(id));
        record.Summary = summary;
        record.ActionItems =
        [
            new ActionItem { Text = "Follow up", IsDone = false },
        ];

        await repo.SaveAsync(record);
        var loaded = await repo.GetByIdAsync(id);

        Assert.NotNull(loaded);
        Assert.Equal(summary, loaded.Summary);
        Assert.Single(loaded.ActionItems);
        Assert.Equal("Follow up", loaded.ActionItems[0].Text);
    }

    [Fact]
    public async Task SaveAsync_WhenFolderIdIsNull_OmitsFolderIdFromFrontmatter()
    {
        var id = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);

        await repo.SaveAsync(CreateRecord(id, AudioPath(id)));

        var markdown = await File.ReadAllTextAsync(InboxMarkdownPath("Standup"));
        Assert.DoesNotContain("folderId:", markdown, StringComparison.Ordinal);
        Assert.DoesNotContain("## Personal Notes", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SaveAsync_WhenEndedAtIsNull_OmitsEndedAtFromFrontmatter()
    {
        var id = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);

        await repo.SaveAsync(CreateRecord(id, AudioPath(id)));

        var markdown = await File.ReadAllTextAsync(InboxMarkdownPath("Standup"));
        Assert.DoesNotContain("endedAt:", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SaveAsync_WhenEndedAtIsSet_RoundtripsEndedAt()
    {
        var id = Guid.NewGuid();
        var endedAt = DateTimeOffset.Parse("2026-09-01T13:45:00.0000000+00:00");
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        var record = CreateRecord(id, AudioPath(id));
        record.EndedAt = endedAt;

        await repo.SaveAsync(record);
        var loaded = await repo.GetByIdAsync(id);
        var markdown = await File.ReadAllTextAsync(InboxMarkdownPath("Standup"));

        Assert.NotNull(loaded);
        Assert.Equal(endedAt, loaded.EndedAt);
        Assert.Contains("endedAt: " + endedAt.ToString("O"), markdown, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Parse_LegacyFileWithoutEndedAt_LeavesEndedAtNull()
    {
        var id = Guid.NewGuid();
        Directory.CreateDirectory(_tempDirectory);
        var path = Path.Combine(_tempDirectory, $"{id}.md");
        var markdown =
            "---\n" +
            $"id: {id}\n" +
            "title: Standup\n" +
            "recordedAt: 2026-09-01T12:00:00.0000000+00:00\n" +
            $"audioFilePath: {AudioPath(id)}\n" +
            "---\n\n" +
            "## Transcript\n\n" +
            "hello\n";
        await File.WriteAllTextAsync(path, markdown);
        var repo = new MarkdownMeetingRepository(_tempDirectory);

        var loaded = await repo.GetByIdAsync(id);

        Assert.NotNull(loaded);
        Assert.Null(loaded.EndedAt);
        Assert.Equal("hello", loaded.Transcript);
    }

    [Fact]
    public async Task SaveAsync_WhenFolderIdIsSet_RoundtripsFolderId()
    {
        var id = Guid.NewGuid();
        var folderId = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        var record = CreateRecord(id, AudioPath(id));
        record.FolderId = folderId;

        await repo.SaveAsync(record);
        var loaded = await repo.GetByIdAsync(id);

        Assert.NotNull(loaded);
        Assert.Equal(folderId, loaded.FolderId);
    }

    [Fact]
    public async Task SaveAsync_WhenNotesSet_RoundtripsPersonalNotesSection()
    {
        var id = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        var record = CreateRecord(id, AudioPath(id));
        record.Notes = "Remember the exam date.";

        await repo.SaveAsync(record);
        var loaded = await repo.GetByIdAsync(id);
        var markdown = await File.ReadAllTextAsync(InboxMarkdownPath("Standup"));

        Assert.NotNull(loaded);
        Assert.Equal("Remember the exam date.", loaded.Notes);
        Assert.Contains("## Personal Notes", markdown, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Parse_LegacyFileWithoutFolderIdOrNotes_LeavesThemNull()
    {
        var id = Guid.NewGuid();
        Directory.CreateDirectory(_tempDirectory);
        var path = Path.Combine(_tempDirectory, $"{id}.md");
        var markdown =
            "---\n" +
            $"id: {id}\n" +
            "title: Standup\n" +
            "recordedAt: 2026-09-01T12:00:00.0000000+00:00\n" +
            $"audioFilePath: {AudioPath(id)}\n" +
            "---\n\n" +
            "## Transcript\n\n" +
            "hello\n";
        await File.WriteAllTextAsync(path, markdown);
        var repo = new MarkdownMeetingRepository(_tempDirectory);

        var loaded = await repo.GetByIdAsync(id);

        Assert.NotNull(loaded);
        Assert.Null(loaded.FolderId);
        Assert.Null(loaded.Notes);
        Assert.Equal("hello", loaded.Transcript);
    }

    [Fact]
    public async Task SaveAsync_WhenSummaryContainsDecisionsAndPersonalNotes_RoundtripsBoth()
    {
        var id = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        var summary = "Hello\n\n## Decisions\nShip it";
        var record = CreateRecord(id, AudioPath(id));
        record.Summary = summary;
        record.Notes = "Human note";
        record.ActionItems =
        [
            new ActionItem { Text = "Follow up", IsDone = false },
        ];

        await repo.SaveAsync(record);
        var loaded = await repo.GetByIdAsync(id);

        Assert.NotNull(loaded);
        Assert.Equal(summary, loaded.Summary);
        Assert.Equal("Human note", loaded.Notes);
        Assert.Single(loaded.ActionItems);
        Assert.Equal("Follow up", loaded.ActionItems[0].Text);
    }

    [Fact]
    public async Task GetAllAsync_WhenOneFileIsCorrupt_ReturnsTheReadableMeetings()
    {
        var goodId = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        await repo.SaveAsync(CreateRecord(goodId, AudioPath(goodId)));
        Directory.CreateDirectory(_tempDirectory);
        await File.WriteAllTextAsync(Path.Combine(_tempDirectory, "corrupt.md"), "not a meeting");

        var records = await repo.GetAllAsync();

        Assert.Single(records);
        Assert.Equal(goodId, records[0].Id);
    }

    [Fact]
    public async Task DeleteAsync_DoesNotRewriteSiblingMeetings()
    {
        var keptId = Guid.NewGuid();
        var deletedId = Guid.NewGuid();
        var repo = new MarkdownMeetingRepository(_tempDirectory);
        await repo.SaveAsync(CreateRecord(keptId, AudioPath(keptId), "Keep me"));
        await repo.SaveAsync(CreateRecord(deletedId, AudioPath(deletedId), "Delete me"));
        var keptPath = InboxMarkdownPath("Keep me");
        var original = await File.ReadAllTextAsync(keptPath);
        var originalWriteTime = File.GetLastWriteTimeUtc(keptPath);

        await repo.DeleteAsync(deletedId);

        Assert.Equal(original, await File.ReadAllTextAsync(keptPath));
        Assert.Equal(originalWriteTime, File.GetLastWriteTimeUtc(keptPath));
        var remaining = await repo.GetAllAsync();
        Assert.Single(remaining);
        Assert.Equal(keptId, remaining[0].Id);
    }

    [Fact]
    public async Task SaveAsync_WhenFolderIdChanges_MovesMarkdownAndWavTogether()
    {
        var id = Guid.NewGuid();
        var folderId = Guid.NewGuid();
        var folders = new JsonFolderRepository(Path.Combine(_tempDirectory, "folders.json"));
        await folders.SaveAsync(new FolderRecord
        {
            Id = folderId,
            Name = "Universidad",
            CreatedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
        });
        var wavPath = AudioPath(id);
        Directory.CreateDirectory(_tempDirectory);
        await File.WriteAllTextAsync(wavPath, "wav");
        var repo = new MarkdownMeetingRepository(_tempDirectory, folders);
        var record = CreateRecord(id, wavPath, "Clase");
        await repo.SaveAsync(record);

        record.FolderId = folderId;
        await repo.SaveAsync(record);

        Assert.False(File.Exists(InboxMarkdownPath("Clase")));
        Assert.False(File.Exists(InboxAudioPath("Clase")));
        var movedMd = Path.Combine(_tempDirectory, "Universidad", MeetingLibraryLayout.FileStem(record.RecordedAt, "Clase") + ".md");
        var movedWav = Path.ChangeExtension(movedMd, ".wav");
        Assert.True(File.Exists(movedMd));
        Assert.True(File.Exists(movedWav));
        Assert.Equal("wav", await File.ReadAllTextAsync(movedWav));
        var loaded = await repo.GetByIdAsync(id);
        Assert.Equal(folderId, loaded?.FolderId);
        Assert.Equal(movedWav, loaded?.AudioFilePath);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    private string AudioPath(Guid id) => Path.Combine(_tempDirectory, $"{id}.wav");

    private string InboxMarkdownPath(string title) =>
        Path.Combine(_tempDirectory, MeetingLibraryLayout.InboxFolderName, MeetingLibraryLayout.FileStem(DateTimeOffset.Parse("2026-09-01T12:00:00Z"), title) + ".md");

    private string InboxAudioPath(string title) => Path.ChangeExtension(InboxMarkdownPath(title), ".wav");

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
