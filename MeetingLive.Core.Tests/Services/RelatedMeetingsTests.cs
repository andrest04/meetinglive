using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class RelatedMeetingsTests
{
    [Fact]
    public void Find_SharedSeriesId_ReturnsOtherMeetingsNewestFirst()
    {
        var current = Meeting(Guid.NewGuid(), "Weekly", At(3), "series-1");
        var older = Meeting(Guid.NewGuid(), "Other title", At(1), "series-1");
        var newer = Meeting(Guid.NewGuid(), "Also other", At(2), "series-1");
        var unrelated = Meeting(Guid.NewGuid(), "Solo", At(4), "series-2");

        var related = RelatedMeetings.Find(current, [older, current, newer, unrelated]);

        Assert.Equal([newer.Id, older.Id], related.Select(meeting => meeting.Id));
    }

    [Fact]
    public void Find_ExactTrimmedTitle_MatchesWithoutSeries()
    {
        var current = Meeting(Guid.NewGuid(), " Standup ", At(2));
        var match = Meeting(Guid.NewGuid(), "Standup", At(1));
        var different = Meeting(Guid.NewGuid(), "standup", At(3));

        var related = RelatedMeetings.Find(current, [match, different]);

        var only = Assert.Single(related);
        Assert.Equal(match.Id, only.Id);
    }

    [Fact]
    public void Find_EmptySeriesId_DoesNotMatchOtherEmptySeries()
    {
        var current = Meeting(Guid.NewGuid(), "One", At(1), "  ");
        var other = Meeting(Guid.NewGuid(), "Two", At(2), null);

        var related = RelatedMeetings.Find(current, [other]);

        Assert.Empty(related);
    }

    [Fact]
    public void FindByEventId_SameCalendarEvent_ReturnsNewestAndIgnoresBlankIds()
    {
        var older = Meeting(Guid.NewGuid(), "Old", At(1));
        older.CalendarEventId = "appt-1";
        var newer = Meeting(Guid.NewGuid(), "New", At(2));
        newer.CalendarEventId = "appt-1";
        var blank = Meeting(Guid.NewGuid(), "Blank", At(3));
        blank.CalendarEventId = " ";

        var match = CalendarMeetingMatch.FindByEventId([older, newer, blank], "appt-1");
        var none = CalendarMeetingMatch.FindByEventId([blank], " ");

        Assert.Equal(newer.Id, match?.Id);
        Assert.Null(none);
    }

    private static DateTimeOffset At(int hour) => DateTimeOffset.Parse($"2026-09-0{hour}T12:00:00Z");

    private static MeetingRecord Meeting(Guid id, string title, DateTimeOffset recordedAt, string? seriesId = null) => new()
    {
        Id = id,
        Title = title,
        RecordedAt = recordedAt,
        AudioFilePath = "a.wav",
        SeriesId = seriesId,
    };
}
