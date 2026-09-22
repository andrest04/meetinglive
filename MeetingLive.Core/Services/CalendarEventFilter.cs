using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Hides blocks that are not meetings. Keeps a timed busy or tentative event that has a subject.
/// Focus time and working location are matched on the English subject Windows Calendar writes.
/// Out of office and working elsewhere are also matched on <see cref="CalendarBusyStatus"/>, which is language-neutral.
/// </summary>
public static class CalendarEventFilter
{
    public static IReadOnlyList<CalendarEvent> Visible(IEnumerable<CalendarEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        return events.Where(IsVisible).ToArray();
    }

    public static bool IsVisible(CalendarEvent calendarEvent)
    {
        ArgumentNullException.ThrowIfNull(calendarEvent);
        if (calendarEvent.IsAllDay || calendarEvent.IsDeclined)
            return false;

        if (calendarEvent.BusyStatus is CalendarBusyStatus.OutOfOffice or CalendarBusyStatus.WorkingElsewhere)
            return false;

        if (IsBlockedSubject(calendarEvent.Subject))
            return false;

        if (string.IsNullOrWhiteSpace(calendarEvent.Subject))
            return false;

        if (calendarEvent.BusyStatus is CalendarBusyStatus.Busy or CalendarBusyStatus.Tentative)
            return true;

        // A free (or unknown) block is a meeting only when it has a join link or attendees.
        return IsMeeting(calendarEvent);
    }

    private static bool IsMeeting(CalendarEvent calendarEvent) =>
        !string.IsNullOrWhiteSpace(calendarEvent.JoinUrl) || calendarEvent.AttendeeDisplayNames.Count > 0;

    private static bool IsBlockedSubject(string? subject)
    {
        if (string.IsNullOrWhiteSpace(subject))
            return false;

        var trimmed = subject.Trim();
        if (trimmed.Equals("Focus time", StringComparison.OrdinalIgnoreCase))
            return true;
        if (trimmed.Equals("Out of office", StringComparison.OrdinalIgnoreCase))
            return true;
        if (trimmed.Equals("Working elsewhere", StringComparison.OrdinalIgnoreCase))
            return true;
        if (trimmed.Equals("Working location", StringComparison.OrdinalIgnoreCase))
            return true;
        return trimmed.StartsWith("Working location:", StringComparison.OrdinalIgnoreCase);
    }
}
