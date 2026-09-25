using System.Globalization;
using MeetingLive.Core.Models;

namespace MeetingLive_App.ViewModels;

/// <summary>One row in the Summary page's "Related meetings" list — same calendar series or
/// exact title as the open meeting (see <see cref="MeetingLive.Core.Services.RelatedMeetings"/>).</summary>
public sealed class RelatedMeetingItem
{
    public required Guid Id { get; init; }

    public required string Title { get; init; }

    public required string DateLabel { get; init; }

    public static RelatedMeetingItem From(MeetingRecord record) => new()
    {
        Id = record.Id,
        Title = record.Title,
        DateLabel = record.RecordedAt.LocalDateTime.ToString("g", CultureInfo.CurrentCulture),
    };
}
