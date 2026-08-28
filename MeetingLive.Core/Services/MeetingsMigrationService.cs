namespace MeetingLive.Core.Services;

/// <summary>
/// One-time migration from the legacy single-file <c>meetings.json</c> store to
/// per-meeting Markdown files under <see cref="AppPaths.MeetingsDirectory"/>.
/// Meeting history is the app's only source of persisted data, so a failed
/// migration is left to throw and surface as a visible error instead of
/// silently losing the user's meetings.
/// </summary>
public sealed class MeetingsMigrationService
{
    private readonly IMeetingRepository _meetings;
    private readonly LegacyJsonMeetingRepository _legacyRepository;

    public MeetingsMigrationService(IMeetingRepository meetings)
        : this(meetings, new LegacyJsonMeetingRepository())
    {
    }

    internal MeetingsMigrationService(IMeetingRepository meetings, LegacyJsonMeetingRepository legacyRepository)
    {
        _meetings = meetings;
        _legacyRepository = legacyRepository;
    }

    /// <summary>
    /// No-op when <see cref="AppPaths.MeetingsFilePath"/> doesn't exist — covers both a
    /// fresh install and an install that already migrated. Otherwise reads every legacy
    /// record, writes each as a Markdown file, and renames <c>meetings.json</c> to
    /// <c>meetings.json.bak</c> (never deletes it) as a safety net.
    /// </summary>
    public async Task MigrateIfNeededAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(AppPaths.MeetingsFilePath))
            return;

        var legacyRecords = await _legacyRepository.GetAllAsync(cancellationToken);
        foreach (var record in legacyRecords)
            await _meetings.SaveAsync(record, cancellationToken);

        var backupPath = AppPaths.MeetingsFilePath + ".bak";
        File.Move(AppPaths.MeetingsFilePath, backupPath, overwrite: true);
    }
}
