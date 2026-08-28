using System.Text.Json;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Reads <see cref="MeetingRecord"/>s from the old single-file JSON store
/// (<see cref="AppPaths.MeetingsFilePath"/>). Superseded by
/// <see cref="MarkdownMeetingRepository"/>; kept internal, no longer exposed via
/// <see cref="IMeetingRepository"/>, and used only by <see cref="MeetingsMigrationService"/>
/// to migrate existing installs.
/// </summary>
internal sealed class LegacyJsonMeetingRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public async Task<IReadOnlyList<MeetingRecord>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(AppPaths.MeetingsFilePath))
            return [];

        await using var stream = File.OpenRead(AppPaths.MeetingsFilePath);
        var records = await JsonSerializer.DeserializeAsync<List<MeetingRecord>>(stream, JsonOptions, cancellationToken);
        return records ?? [];
    }
}
