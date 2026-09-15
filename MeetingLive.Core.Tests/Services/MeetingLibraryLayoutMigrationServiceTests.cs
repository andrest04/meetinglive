using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingLibraryLayoutMigrationServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    [Fact]
    public async Task MigrateIfNeededAsync_MovesGuidFilesIntoInboxWithTitleAndSidecarWav()
    {
        var id = Guid.NewGuid();
        var leftoverMeetings = Path.Combine(_root, "Meetings");
        var leftoverRecordings = Path.Combine(_root, "Recordings");
        Directory.CreateDirectory(leftoverMeetings);
        Directory.CreateDirectory(leftoverRecordings);
        var wavPath = Path.Combine(leftoverRecordings, $"{id}.wav");
        await File.WriteAllTextAsync(wavPath, "wav");
        await File.WriteAllTextAsync(
            Path.Combine(leftoverMeetings, $"{id}.md"),
            $"---\nid: {id}\ntitle: Standup\nrecordedAt: 2026-09-01T12:00:00.0000000+00:00\naudioFilePath: {wavPath}\n---\n");
        var folders = new JsonFolderRepository(Path.Combine(_root, "folders.json"));
        var meetings = new MarkdownMeetingRepository(_root, folders);
        var service = new MeetingLibraryLayoutMigrationService(
            _root, leftoverMeetings, leftoverRecordings, folders, meetings);

        await service.MigrateIfNeededAsync();

        var stem = MeetingLibraryLayout.FileStem(DateTimeOffset.Parse("2026-09-01T12:00:00Z"), "Standup");
        var md = Path.Combine(_root, "Inbox", stem + ".md");
        var wav = Path.Combine(_root, "Inbox", stem + ".wav");
        Assert.True(File.Exists(md));
        Assert.True(File.Exists(wav));
        Assert.False(File.Exists(Path.Combine(leftoverMeetings, $"{id}.md")));
        Assert.False(Directory.Exists(leftoverMeetings));
        var loaded = await meetings.GetByIdAsync(id);
        Assert.Equal(wav, loaded?.AudioFilePath);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }
}
