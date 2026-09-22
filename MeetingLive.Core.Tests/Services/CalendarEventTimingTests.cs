using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CalendarEventTimingTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-09-21T15:00:00Z");

    [Fact]
    public void ShouldStartCapture_FutureStart_DoesNotStart()
    {
        var calendarEvent = Event(Now.AddMinutes(10), TimeSpan.FromMinutes(30));

        Assert.False(CalendarEventTiming.ShouldStartCapture(calendarEvent, Now));
    }

    [Fact]
    public void ShouldStartCapture_StartIsNow_Starts()
    {
        var calendarEvent = Event(Now, TimeSpan.FromMinutes(30));

        Assert.True(CalendarEventTiming.ShouldStartCapture(calendarEvent, Now));
    }

    [Fact]
    public void ShouldStartCapture_EndedWithinGrace_Starts()
    {
        var calendarEvent = Event(Now.AddMinutes(-20), TimeSpan.FromMinutes(16));

        Assert.True(CalendarEventTiming.ShouldStartCapture(calendarEvent, Now));
    }

    [Fact]
    public void ShouldStartCapture_EndedBeyondGrace_DoesNotStart()
    {
        var calendarEvent = Event(Now.AddMinutes(-20), TimeSpan.FromMinutes(10));

        Assert.False(CalendarEventTiming.ShouldStartCapture(calendarEvent, Now));
    }

    [Fact]
    public void IsStillRelevant_EndedBeyondGrace_IsNotUpcoming()
    {
        var calendarEvent = Event(Now.AddHours(-2), TimeSpan.FromMinutes(30));

        Assert.False(CalendarEventTiming.IsStillRelevant(calendarEvent, Now));
    }

    [Fact]
    public void IsStillRelevant_StartsInsideLookahead_IsUpcoming()
    {
        var calendarEvent = Event(Now.AddDays(13), TimeSpan.FromMinutes(30));

        Assert.True(CalendarEventTiming.IsStillRelevant(calendarEvent, Now));
    }

    private static CalendarEvent Event(DateTimeOffset start, TimeSpan duration) => new()
    {
        EventId = "event-1",
        CalendarId = "cal-1",
        CalendarName = "Work",
        Subject = "Standup",
        Start = start,
        Duration = duration,
        BusyStatus = CalendarBusyStatus.Busy,
    };
}
