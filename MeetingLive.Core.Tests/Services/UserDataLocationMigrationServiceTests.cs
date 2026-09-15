using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class UserDataLocationMigrationServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    [Fact]
    public void MigrateIfNeeded_MovesMeetingsRecordingsAndFolders_AndRewritesAudioPath()
    {
        var id = Guid.NewGuid();
        var legacyMeetings = Path.Combine(_root, "legacy", "Meetings");
        var legacyRecordings = Path.Combine(_root, "legacy", "Recordings");
        var legacyFolders = Path.Combine(_root, "legacy", "folders.json");
        var meetings = Path.Combine(_root, "user", "Meetings");
        var recordings = Path.Combine(_root, "user", "Recordings");
        var folders = Path.Combine(_root, "user", "folders.json");
        Directory.CreateDirectory(legacyMeetings);
        Directory.CreateDirectory(legacyRecordings);
        var wavName = $"{id}.wav";
        File.WriteAllText(Path.Combine(legacyRecordings, wavName), "wav");
        File.WriteAllText(
            Path.Combine(legacyMeetings, $"{id}.md"),
            $"---\nid: {id}\ntitle: Standup\nrecordedAt: 2026-09-01T12:00:00.0000000+00:00\naudioFilePath: {Path.Combine(legacyRecordings, wavName)}\n---\n");
        File.WriteAllText(legacyFolders, "[]");
        File.WriteAllText(Path.Combine(_root, "legacy", "settings.json"), "{}");
        var service = new UserDataLocationMigrationService(
            legacyMeetings, legacyRecordings, legacyFolders, meetings, recordings, folders);

        service.MigrateIfNeeded();

        Assert.True(File.Exists(Path.Combine(meetings, $"{id}.md")));
        Assert.True(File.Exists(Path.Combine(recordings, wavName)));
        Assert.True(File.Exists(folders));
        Assert.False(File.Exists(Path.Combine(legacyMeetings, $"{id}.md")));
        Assert.False(File.Exists(Path.Combine(legacyRecordings, wavName)));
        Assert.False(File.Exists(legacyFolders));
        Assert.True(File.Exists(Path.Combine(_root, "legacy", "settings.json")));
        var markdown = File.ReadAllText(Path.Combine(meetings, $"{id}.md"));
        Assert.Contains(Path.Combine(recordings, wavName), markdown, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(legacyRecordings, markdown, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void MigrateIfNeeded_WhenDestinationExists_DoesNotOverwrite()
    {
        var id = Guid.NewGuid();
        var legacyMeetings = Path.Combine(_root, "legacy", "Meetings");
        var meetings = Path.Combine(_root, "user", "Meetings");
        Directory.CreateDirectory(legacyMeetings);
        Directory.CreateDirectory(meetings);
        File.WriteAllText(Path.Combine(legacyMeetings, $"{id}.md"), "legacy");
        File.WriteAllText(Path.Combine(meetings, $"{id}.md"), "keep");
        var service = new UserDataLocationMigrationService(
            legacyMeetings,
            Path.Combine(_root, "legacy", "Recordings"),
            Path.Combine(_root, "legacy", "folders.json"),
            meetings,
            Path.Combine(_root, "user", "Recordings"),
            Path.Combine(_root, "user", "folders.json"));

        service.MigrateIfNeeded();

        Assert.Equal("keep", File.ReadAllText(Path.Combine(meetings, $"{id}.md")));
        Assert.Equal("legacy", File.ReadAllText(Path.Combine(legacyMeetings, $"{id}.md")));
    }

    [Fact]
    public void MigrateIfNeeded_WhenAlreadyMigrated_IsIdempotent()
    {
        var meetings = Path.Combine(_root, "user", "Meetings");
        var recordings = Path.Combine(_root, "user", "Recordings");
        var folders = Path.Combine(_root, "user", "folders.json");
        Directory.CreateDirectory(meetings);
        File.WriteAllText(Path.Combine(meetings, "a.md"), "ok");
        var service = new UserDataLocationMigrationService(
            Path.Combine(_root, "legacy", "Meetings"),
            Path.Combine(_root, "legacy", "Recordings"),
            Path.Combine(_root, "legacy", "folders.json"),
            meetings,
            recordings,
            folders);

        service.MigrateIfNeeded();
        service.MigrateIfNeeded();

        Assert.Equal("ok", File.ReadAllText(Path.Combine(meetings, "a.md")));
    }

    [Fact]
    public void RewriteAudioFilePathLine_WhenPathIsLegacy_RewritesDirectory()
    {
        var legacy = Path.Combine(_root, "legacy", "Recordings");
        var recordings = Path.Combine(_root, "user", "Recordings");
        var id = Guid.NewGuid();
        var markdown = $"audioFilePath: {Path.Combine(legacy, $"{id}.wav")}\n";

        var updated = UserDataLocationMigrationService.RewriteAudioFilePathLine(markdown, legacy, recordings);

        Assert.Equal($"audioFilePath: {Path.Combine(recordings, $"{id}.wav")}\n", updated);
    }

    [Fact]
    public void RewriteAudioFilePathLine_WhenPathIsAlreadyNew_LeavesMarkdown()
    {
        var legacy = Path.Combine(_root, "legacy", "Recordings");
        var recordings = Path.Combine(_root, "user", "Recordings");
        var markdown = $"audioFilePath: {Path.Combine(recordings, "a.wav")}\n";

        var updated = UserDataLocationMigrationService.RewriteAudioFilePathLine(markdown, legacy, recordings);

        Assert.Equal(markdown, updated);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }
}
