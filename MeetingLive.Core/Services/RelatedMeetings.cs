using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Other meetings that share a non-empty series id, or the exact trimmed title (ordinal).
/// The current id is excluded. Order is <see cref="MeetingRecord.RecordedAt"/> descending.
/// </summary>
public static class RelatedMeetings
{
    public static IReadOnlyList<MeetingRecord> Find(MeetingRecord current, IEnumerable<MeetingRecord> candidates)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(candidates);

        var seriesId = Normalize(current.SeriesId);
        var title = current.Title?.Trim() ?? string.Empty;

        return candidates
            .Where(candidate => candidate.Id != current.Id)
            .Where(candidate => SharesSeries(seriesId, candidate) || SameTitle(title, candidate))
            .OrderByDescending(candidate => candidate.RecordedAt)
            .ToArray();
    }

    private static bool SharesSeries(string? seriesId, MeetingRecord candidate) =>
        seriesId is not null && string.Equals(seriesId, Normalize(candidate.SeriesId), StringComparison.Ordinal);

    private static bool SameTitle(string title, MeetingRecord candidate) =>
        string.Equals(title, candidate.Title?.Trim() ?? string.Empty, StringComparison.Ordinal);

    private static string? Normalize(string? seriesId) =>
        string.IsNullOrWhiteSpace(seriesId) ? null : seriesId.Trim();
}
