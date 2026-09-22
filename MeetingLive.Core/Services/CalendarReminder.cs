using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// One-minute calendar reminder rule. The watcher owns polling, toasts, and the already-notified set.
/// </summary>
/// <remarks>
/// The notify window is [start - 90 seconds, start). A 15-second poll cannot miss the one-minute
/// mark, and a sample at or after start is too late.
///
/// <see cref="WindowsAppointmentCalendarStore"/> fills <see cref="CalendarEvent.AttendeeDisplayNames"/>
/// from <c>Appointment.Invitees</c> only. Invitees do not include the organizer, and this store does
/// not insert the calendar owner.
///
/// Two shapes:
/// the owner is not in the list, or the list already includes the owner.
/// When <see cref="CalendarEvent.OrganizedByCurrentUser"/> is true, the owner is the organizer and
/// is not in Invitees. One other person means two people in the room.
/// When the list already includes the owner, count those names and require at least two. Do not add
/// the owner again. Windows can write the owner into Invitees on a meeting they were invited to.
/// This store cannot match a display name to the owner, so it leaves
/// <see cref="CalendarEvent.AttendeesIncludeCurrentUser"/> false and uses the first shape.
/// Tests cover both.
///
/// All-day, declined, out-of-office, focus, and free blocks are excluded by
/// <see cref="CalendarEventFilter"/>. This type does not duplicate those checks.
/// </remarks>
public static class CalendarReminder
{
    /// <summary>How early the window opens. Wide enough that a 15-second poll cannot miss one minute before start.</summary>
    public static readonly TimeSpan NotifyLead = TimeSpan.FromSeconds(90);

    /// <summary>Watcher poll. Shorter than <see cref="NotifyLead"/>, so the one-minute mark stays inside the window.</summary>
    public static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(15);

    /// <summary>
    /// True when <paramref name="now"/> is in [start - 90 seconds, start).
    /// </summary>
    public static bool IsInNotifyWindow(DateTimeOffset start, DateTimeOffset now)
    {
        var opens = start - NotifyLead;
        return now >= opens && now < start;
    }

    /// <summary>
    /// Whether Invitees already contain the calendar owner.
    /// The organizer is never in that list. A display-name match is the only other way to know,
    /// and this store does not have one, so <paramref name="ownerMatchedInInvitees"/> is false in production.
    /// </summary>
    public static bool IncludesCurrentUser(bool organizedByCurrentUser, bool ownerMatchedInInvitees) =>
        !organizedByCurrentUser && ownerMatchedInInvitees;

    /// <summary>
    /// People in the room. Blank names do not count.
    /// The owner is added when they are not already in <see cref="CalendarEvent.AttendeeDisplayNames"/>.
    /// </summary>
    public static int CountPeople(CalendarEvent calendarEvent)
    {
        ArgumentNullException.ThrowIfNull(calendarEvent);
        var named = 0;
        foreach (var name in calendarEvent.AttendeeDisplayNames)
        {
            if (!string.IsNullOrWhiteSpace(name))
                named++;
        }

        if (calendarEvent.OrganizedByCurrentUser || !calendarEvent.AttendeesIncludeCurrentUser)
            return named + 1;

        return named;
    }

    public static bool ShouldNotify(
        CalendarEvent calendarEvent,
        DateTimeOffset now,
        IReadOnlySet<string> alreadyNotified)
    {
        ArgumentNullException.ThrowIfNull(calendarEvent);
        ArgumentNullException.ThrowIfNull(alreadyNotified);
        if (string.IsNullOrWhiteSpace(calendarEvent.EventId))
            return false;

        if (alreadyNotified.Contains(calendarEvent.EventId))
            return false;

        if (!CalendarEventFilter.IsVisible(calendarEvent))
            return false;

        if (!IsInNotifyWindow(calendarEvent.Start, now))
            return false;

        return CountPeople(calendarEvent) >= 2;
    }

    /// <summary>
    /// Drops ids whose start has passed so a later occurrence of the same id can notify again.
    /// </summary>
    public static void ForgetStarted(IDictionary<string, DateTimeOffset> notifiedStarts, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(notifiedStarts);
        List<string>? expired = null;
        foreach (var pair in notifiedStarts)
        {
            if (pair.Value <= now)
                (expired ??= []).Add(pair.Key);
        }

        if (expired is null)
            return;

        foreach (var id in expired)
            notifiedStarts.Remove(id);
    }
}
