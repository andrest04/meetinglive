using MeetingLive.Core.Models;

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
    private readonly Func<CancellationToken, Task<IReadOnlyList<MeetingRecord>>> _loadLegacyRecords;
    private readonly string _legacyFilePath;

    public MeetingsMigrationService(IMeetingRepository meetings)
        : this(meetings, new LegacyJsonMeetingRepository().GetAllAsync, AppPaths.MeetingsFilePath)
    {
    }

    internal MeetingsMigrationService(
        IMeetingRepository meetings,
        Func<CancellationToken, Task<IReadOnlyList<MeetingRecord>>> loadLegacyRecords,
        string legacyFilePath)
    {
        _meetings = meetings;
        _loadLegacyRecords = loadLegacyRecords;
        _legacyFilePath = legacyFilePath;
    }

    /// <summary>
    /// No-op when <see cref="AppPaths.MeetingsFilePath"/> doesn't exist — covers both a
    /// fresh install and an install that already migrated. Otherwise writes each legacy record
    /// that has no meeting yet as a Markdown file, and renames <c>meetings.json</c> to a backup
    /// (never deletes it) as a safety net. A meeting already in the target is left alone: it may
    /// hold edits made after an earlier failed run, which is the only way this file can remain.
    /// </summary>
    public async Task MigrateIfNeededAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_legacyFilePath))
            return;

        var legacyRecords = await _loadLegacyRecords(cancellationToken);
        var existing = await _meetings.GetAllAsync(cancellationToken);
        var existingIds = existing.Select(meeting => meeting.Id).ToHashSet();
        foreach (var record in legacyRecords)
        {
            if (!existingIds.Contains(record.Id))
                await _meetings.SaveAsync(record, cancellationToken);
        }

        File.Move(_legacyFilePath, NextFreeBackupPath(), overwrite: false);
    }

    private string NextFreeBackupPath()
    {
        var backupPath = _legacyFilePath + ".bak";
        for (var suffix = 1; File.Exists(backupPath); suffix++)
            backupPath = $"{_legacyFilePath}.bak.{suffix}";

        return backupPath;
    }
}