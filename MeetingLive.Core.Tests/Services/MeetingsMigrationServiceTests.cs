using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public sealed class MeetingsMigrationServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "MeetingLiveTests", Guid.NewGuid().ToString("N"));
    private readonly string _legacyFile;
    private readonly MarkdownMeetingRepository _repository;

    public MeetingsMigrationServiceTests()
    {
        var library = Path.Combine(_root, "library");
        Directory.CreateDirectory(library);
        _legacyFile = Path.Combine(_root, "meetings.json");
        File.WriteAllText(_legacyFile, "[]");
        _repository = new MarkdownMeetingRepository(library);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
            Directory.Delete(_root, recursive: true);
    }

    [Fact]
    public async Task MigrateIfNeededAsync_WhenLegacyFileIsMissing_DoesNothing()
    {
        File.Delete(_legacyFile);
        var loaded = false;
        var service = new MeetingsMigrationService(
            _repository,
            _ =>
            {
                loaded = true;
                return Task.FromResult<IReadOnlyList<MeetingRecord>>([]);
            },
            _legacyFile);

        await service.MigrateIfNeededAsync();

        Assert.False(loaded);
        Assert.Empty(await _repository.GetAllAsync());
    }

    [Fact]
    public async Task MigrateIfNeededAsync_FirstRun_SavesEveryRecordAndRenamesTheFileToBak()
    {
        var first = Meeting("First");
        var second = Meeting("Second");

        await Service(first, second).MigrateIfNeededAsync();

        Assert.NotNull(await _repository.GetByIdAsync(first.Id));
        Assert.NotNull(await _repository.GetByIdAsync(second.Id));
        Assert.False(File.Exists(_legacyFile));
        Assert.Equal("[]", File.ReadAllText(_legacyFile + ".bak"));
    }

    [Fact]
    public async Task MigrateIfNeededAsync_RerunAfterPartialFailure_KeepsLaterEditsAndMigratesTheMissingOnes()
    {
        var first = Meeting("First");
        var second = Meeting("Second");
        var failing = new FailOnSaveRepository(_repository, failOnId: second.Id);

        await Assert.ThrowsAsync<IOException>(
            () => new MeetingsMigrationService(failing, Legacy(first, second), _legacyFile).MigrateIfNeededAsync());
        Assert.True(File.Exists(_legacyFile));

        var edited = await _repository.GetByIdAsync(first.Id);
        edited!.Notes = "Edited after the failed migration.";
        await _repository.SaveAsync(edited);

        await Service(Meeting("First", first.Id), Meeting("Second", second.Id)).MigrateIfNeededAsync();

        var reloaded = await _repository.GetByIdAsync(first.Id);
        Assert.Equal("Edited after the failed migration.", reloaded!.Notes);
        Assert.NotNull(await _repository.GetByIdAsync(second.Id));
        Assert.False(File.Exists(_legacyFile));
    }

    [Fact]
    public async Task MigrateIfNeededAsync_WhenABackupAlreadyExists_KeepsItAndWritesANewOne()
    {
        File.WriteAllText(_legacyFile + ".bak", "older backup");
        File.WriteAllText(_legacyFile, "newer legacy file");

        await Service().MigrateIfNeededAsync();

        Assert.False(File.Exists(_legacyFile));
        Assert.Equal("older backup", File.ReadAllText(_legacyFile + ".bak"));
        Assert.Equal("newer legacy file", File.ReadAllText(_legacyFile + ".bak.1"));
    }

    [Fact]
    public async Task MigrateIfNeededAsync_WhenSeveralBackupsExist_UsesTheNextFreeName()
    {
        File.WriteAllText(_legacyFile + ".bak", "backup 0");
        File.WriteAllText(_legacyFile + ".bak.1", "backup 1");
        File.WriteAllText(_legacyFile, "newest");

        await Service().MigrateIfNeededAsync();

        Assert.Equal("backup 0", File.ReadAllText(_legacyFile + ".bak"));
        Assert.Equal("backup 1", File.ReadAllText(_legacyFile + ".bak.1"));
        Assert.Equal("newest", File.ReadAllText(_legacyFile + ".bak.2"));
    }

    private MeetingsMigrationService Service(params MeetingRecord[] records) =>
        new(_repository, Legacy(records), _legacyFile);

    private static Func<CancellationToken, Task<IReadOnlyList<MeetingRecord>>> Legacy(params MeetingRecord[] records) =>
        _ => Task.FromResult<IReadOnlyList<MeetingRecord>>(records);

    private static MeetingRecord Meeting(string title, Guid? id = null) => new()
    {
        Id = id ?? Guid.NewGuid(),
        Title = title,
        RecordedAt = DateTimeOffset.Parse("2026-09-01T12:00:00.0000000+00:00"),
        AudioFilePath = string.Empty,
        Transcript = "legacy transcript",
    };

    private sealed class FailOnSaveRepository(IMeetingRepository inner, Guid failOnId) : IMeetingRepository
    {
        public Task<IReadOnlyList<MeetingRecord>> GetAllAsync(CancellationToken cancellationToken = default) =>
            inner.GetAllAsync(cancellationToken);

        public Task<MeetingRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default) =>
            inner.GetByIdAsync(id, cancellationToken);

        public Task SaveAsync(MeetingRecord record, CancellationToken cancellationToken = default) =>
            record.Id == failOnId
                ? throw new IOException("Simulated locked file.")
                : inner.SaveAsync(record, cancellationToken);

        public Task DeleteAsync(Guid id, CancellationToken cancellationToken = default) =>
            inner.DeleteAsync(id, cancellationToken);
    }
}