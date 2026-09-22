using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CalendarEventFilterTests
{
    [Fact]
    public void IsVisible_TimedBusyEventWithSubject_KeepsIt()
    {
        var calendarEvent = Event();

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.True(visible);
    }

    [Fact]
    public void IsVisible_TimedTentativeEventWithSubject_KeepsIt()
    {
        var calendarEvent = Event(busy: CalendarBusyStatus.Tentative);

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.True(visible);
    }

    [Fact]
    public void IsVisible_AllDayEvent_HidesIt()
    {
        var calendarEvent = Event(allDay: true);

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void IsVisible_OutOfOffice_HidesIt()
    {
        var calendarEvent = Event(busy: CalendarBusyStatus.OutOfOffice);

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void IsVisible_WorkingElsewhere_HidesIt()
    {
        var calendarEvent = Event(busy: CalendarBusyStatus.WorkingElsewhere);

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void IsVisible_FocusTimeSubject_HidesIt()
    {
        var calendarEvent = Event(subject: "  Focus time  ");

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void IsVisible_WorkingLocationSubject_HidesIt()
    {
        var calendarEvent = Event(subject: "Working location: Home");

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void IsVisible_DeclinedEvent_HidesIt()
    {
        var calendarEvent = Event(declined: true);

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void IsVisible_FreeBlockWithoutMeetingSignals_HidesIt()
    {
        var calendarEvent = Event(subject: "Lunch", busy: CalendarBusyStatus.Free);

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void IsVisible_FreeEventWithJoinUrl_KeepsIt()
    {
        var calendarEvent = Event(busy: CalendarBusyStatus.Free, joinUrl: "https://meet.example/abc");

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.True(visible);
    }

    [Fact]
    public void IsVisible_BusyEventWithoutSubject_HidesIt()
    {
        var calendarEvent = Event(subject: "   ");

        var visible = CalendarEventFilter.IsVisible(calendarEvent);

        Assert.False(visible);
    }

    [Fact]
    public void Visible_MixedEvents_ReturnsOnlyMeetings()
    {
        var events = new[]
        {
            Event(subject: "Standup"),
            Event(subject: "Focus time"),
            Event(subject: "OOO", busy: CalendarBusyStatus.OutOfOffice),
        };

        var visible = CalendarEventFilter.Visible(events);

        var kept = Assert.Single(visible);
        Assert.Equal("Standup", kept.Subject);
    }

    private static CalendarEvent Event(
        string subject = "Standup",
        CalendarBusyStatus busy = CalendarBusyStatus.Busy,
        bool allDay = false,
        bool declined = false,
        string? joinUrl = null) => new()
    {
        EventId = "event-1",
        CalendarId = "cal-1",
        CalendarName = "Work",
        Subject = subject,
        Start = DateTimeOffset.Parse("2026-09-21T15:00:00Z"),
        Duration = TimeSpan.FromMinutes(30),
        BusyStatus = busy,
        IsAllDay = allDay,
        IsDeclined = declined,
        JoinUrl = joinUrl,
    };
}
