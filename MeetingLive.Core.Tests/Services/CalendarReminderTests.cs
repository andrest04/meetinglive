using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CalendarReminderTests
{
    private static readonly DateTimeOffset Start = new(2026, 9, 22, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public void IsInNotifyWindow_AtLeadAndOneMinuteBefore_IsInside()
    {
        Assert.True(CalendarReminder.IsInNotifyWindow(Start, Start - CalendarReminder.NotifyLead));
        Assert.True(CalendarReminder.IsInNotifyWindow(Start, Start - TimeSpan.FromMinutes(1)));
        Assert.True(CalendarReminder.IsInNotifyWindow(Start, Start - TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void IsInNotifyWindow_BeforeLeadOrAtStart_IsOutside()
    {
        Assert.False(CalendarReminder.IsInNotifyWindow(Start, Start - CalendarReminder.NotifyLead - TimeSpan.FromSeconds(1)));
        Assert.False(CalendarReminder.IsInNotifyWindow(Start, Start));
        Assert.False(CalendarReminder.IsInNotifyWindow(Start, Start + TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void IsInNotifyWindow_FifteenSecondPoll_CannotMissTheOneMinuteMark()
    {
        var oneMinuteBefore = Start - TimeSpan.FromMinutes(1);

        for (var phase = 0; phase < 15; phase++)
        {
            var hit = false;
            var origin = Start - TimeSpan.FromMinutes(5) + TimeSpan.FromSeconds(phase);
            for (var sample = origin; sample < Start + TimeSpan.FromMinutes(1); sample += CalendarReminder.PollInterval)
            {
                if (!CalendarReminder.IsInNotifyWindow(Start, sample))
                    continue;

                Assert.True(sample < Start);
                if (sample <= oneMinuteBefore && oneMinuteBefore - sample < CalendarReminder.PollInterval)
                    hit = true;
            }

            Assert.True(hit);
        }
    }

    [Fact]
    public void IncludesCurrentUser_WhenOrganizedByUser_IsFalseEvenIfANameWasMatched()
    {
        var includes = CalendarReminder.IncludesCurrentUser(organizedByCurrentUser: true, ownerMatchedInInvitees: true);

        Assert.False(includes);
    }

    [Theory]
    [InlineData(false, false, false)]
    [InlineData(false, true, true)]
    public void IncludesCurrentUser_WhenNotOrganizer_FollowsTheInviteeMatch(
        bool organizedByCurrentUser,
        bool ownerMatchedInInvitees,
        bool expected)
    {
        var includes = CalendarReminder.IncludesCurrentUser(organizedByCurrentUser, ownerMatchedInInvitees);

        Assert.Equal(expected, includes);
    }

    [Fact]
    public void CountPeople_WhenOwnerIsNotInTheList_OneOtherPersonIsTwoPeople()
    {
        var calendarEvent = Event(attendees: ["Ada Lovelace"]);

        var people = CalendarReminder.CountPeople(calendarEvent);

        Assert.Equal(2, people);
    }

    [Fact]
    public void CountPeople_WhenOwnerOrganized_DoesNotTreatThemAsAlreadyListed()
    {
        var calendarEvent = Event(attendees: ["Ada Lovelace"], organizedByCurrentUser: true, attendeesIncludeCurrentUser: true);

        var people = CalendarReminder.CountPeople(calendarEvent);

        Assert.Equal(2, people);
    }

    [Fact]
    public void CountPeople_WhenListAlreadyIncludesTheOwner_DoesNotAddThemAgain()
    {
        var alone = Event(attendees: ["You"], attendeesIncludeCurrentUser: true);
        var withSomeone = Event(attendees: ["You", "Ada Lovelace"], attendeesIncludeCurrentUser: true);

        Assert.Equal(1, CalendarReminder.CountPeople(alone));
        Assert.Equal(2, CalendarReminder.CountPeople(withSomeone));
    }

    [Fact]
    public void CountPeople_BlankNames_DoNotCount()
    {
        var calendarEvent = Event(attendees: ["  ", "Ada Lovelace"]);

        var people = CalendarReminder.CountPeople(calendarEvent);

        Assert.Equal(2, people);
    }

    [Fact]
    public void ShouldNotify_OneOtherPersonInsideTheWindow_Notifies()
    {
        var calendarEvent = Event(attendees: ["Ada Lovelace"]);
        var now = Start - TimeSpan.FromMinutes(1);

        var notify = CalendarReminder.ShouldNotify(calendarEvent, now, AlreadyNotified());

        Assert.True(notify);
    }

    [Fact]
    public void ShouldNotify_OwnerAlreadyListedAlone_DoesNotNotify()
    {
        var calendarEvent = Event(attendees: ["You"], attendeesIncludeCurrentUser: true);
        var now = Start - TimeSpan.FromMinutes(1);

        var notify = CalendarReminder.ShouldNotify(calendarEvent, now, AlreadyNotified());

        Assert.False(notify);
    }

    [Fact]
    public void ShouldNotify_NoOtherPerson_DoesNotNotify()
    {
        var calendarEvent = Event();
        var now = Start - TimeSpan.FromMinutes(1);

        var notify = CalendarReminder.ShouldNotify(calendarEvent, now, AlreadyNotified());

        Assert.False(notify);
    }

    [Theory]
    [InlineData(true, false, CalendarBusyStatus.Busy, "Standup")]
    [InlineData(false, true, CalendarBusyStatus.Busy, "Standup")]
    [InlineData(false, false, CalendarBusyStatus.OutOfOffice, "Standup")]
    [InlineData(false, false, CalendarBusyStatus.Busy, "Focus time")]
    public void ShouldNotify_BlockedByCalendarEventFilter_DoesNotNotify(
        bool allDay,
        bool declined,
        CalendarBusyStatus busy,
        string subject)
    {
        var calendarEvent = Event(
            subject: subject,
            busy: busy,
            allDay: allDay,
            declined: declined,
            attendees: ["Ada Lovelace"]);
        var now = Start - TimeSpan.FromMinutes(1);

        var notify = CalendarReminder.ShouldNotify(calendarEvent, now, AlreadyNotified());

        Assert.False(notify);
        Assert.False(CalendarEventFilter.IsVisible(calendarEvent));
    }

    [Fact]
    public void ShouldNotify_FreeBlockWithoutMeetingSignal_DoesNotNotify()
    {
        var calendarEvent = Event(subject: "Hold", busy: CalendarBusyStatus.Free);
        var now = Start - TimeSpan.FromMinutes(1);

        var notify = CalendarReminder.ShouldNotify(calendarEvent, now, AlreadyNotified());

        Assert.False(notify);
        Assert.False(CalendarEventFilter.IsVisible(calendarEvent));
    }

    [Fact]
    public void ShouldNotify_AlreadyNotified_DoesNotNotifyAgain()
    {
        var calendarEvent = Event(attendees: ["Ada Lovelace"]);
        var now = Start - TimeSpan.FromMinutes(1);
        var notified = AlreadyNotified(calendarEvent.EventId);

        var notify = CalendarReminder.ShouldNotify(calendarEvent, now, notified);

        Assert.False(notify);
    }

    [Fact]
    public void ShouldNotify_AfterStart_DoesNotNotify()
    {
        var calendarEvent = Event(attendees: ["Ada Lovelace"]);

        var notify = CalendarReminder.ShouldNotify(calendarEvent, Start, AlreadyNotified());

        Assert.False(notify);
    }

    [Fact]
    public void ForgetStarted_WhenStartHasPassed_DropsTheIdSoALaterOccurrenceCanNotify()
    {
        var notified = new Dictionary<string, DateTimeOffset>(StringComparer.Ordinal)
        {
            ["event-1"] = Start,
        };

        CalendarReminder.ForgetStarted(notified, Start);

        Assert.Empty(notified);
        var later = Event(start: Start + TimeSpan.FromHours(2), attendees: ["Ada Lovelace"]);
        Assert.True(CalendarReminder.ShouldNotify(later, later.Start - TimeSpan.FromMinutes(1), notified.Keys.ToHashSet(StringComparer.Ordinal)));
    }

    [Fact]
    public void ForgetStarted_BeforeStart_KeepsTheId()
    {
        var notified = new Dictionary<string, DateTimeOffset>(StringComparer.Ordinal)
        {
            ["event-1"] = Start,
        };

        CalendarReminder.ForgetStarted(notified, Start - TimeSpan.FromSeconds(1));

        Assert.Contains("event-1", notified.Keys);
    }

    private static HashSet<string> AlreadyNotified(params string[] ids) =>
        new(ids, StringComparer.Ordinal);

    private static CalendarEvent Event(
        string subject = "Standup",
        CalendarBusyStatus busy = CalendarBusyStatus.Busy,
        bool allDay = false,
        bool declined = false,
        bool organizedByCurrentUser = false,
        bool attendeesIncludeCurrentUser = false,
        DateTimeOffset? start = null,
        params string[] attendees) => new()
    {
        EventId = "event-1",
        CalendarId = "cal-1",
        CalendarName = "Work",
        Subject = subject,
        Start = start ?? Start,
        Duration = TimeSpan.FromMinutes(30),
        BusyStatus = busy,
        IsAllDay = allDay,
        IsDeclined = declined,
        OrganizedByCurrentUser = organizedByCurrentUser,
        AttendeesIncludeCurrentUser = attendeesIncludeCurrentUser,
        AttendeeDisplayNames = attendees,
    };
}
