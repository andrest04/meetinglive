using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Coming up and the click-to-record decision share one clock.
/// A meeting that ended within <see cref="EndGrace"/> (five minutes) is still "now":
/// it stays in the list and a click starts capture. Beyond that grace it is over.
/// </summary>
public static class CalendarEventTiming
{
    public static readonly TimeSpan EndGrace = TimeSpan.FromMinutes(5);

    /// <summary>How far ahead Coming up looks, and how far the store reads.</summary>
    public static readonly TimeSpan Lookahead = TimeSpan.FromDays(14);

    /// <summary>How far back the store reads so an in-progress meeting is still returned.</summary>
    public static readonly TimeSpan Lookback = TimeSpan.FromDays(1);

    public static bool IsStillRelevant(CalendarEvent calendarEvent, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(calendarEvent);
        var end = calendarEvent.Start + calendarEvent.Duration;
        return end + EndGrace >= now && calendarEvent.Start <= now + Lookahead;
    }

    /// <summary>
    /// True when start is now or in the past and the event has not been over for more than <see cref="EndGrace"/>.
    /// A future start is prep only and must not start capture.
    /// </summary>
    public static bool ShouldStartCapture(CalendarEvent calendarEvent, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(calendarEvent);
        if (calendarEvent.Start > now)
            return false;

        var end = calendarEvent.Start + calendarEvent.Duration;
        return now <= end + EndGrace;
    }
}
