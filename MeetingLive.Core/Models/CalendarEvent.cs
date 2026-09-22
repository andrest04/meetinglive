namespace MeetingLive.Core.Models;

/// <summary>
/// One timed calendar event the UI and the meeting link can share.
/// This is not a WinRT appointment. The Windows store adapter maps into this type.
/// </summary>
public sealed class CalendarEvent
{
    public required string EventId { get; init; }

    public required string CalendarId { get; init; }

    public required string CalendarName { get; init; }

    public required string Subject { get; init; }

    public required DateTimeOffset Start { get; init; }

    public required TimeSpan Duration { get; init; }

    public string? Location { get; init; }

    /// <summary>Agenda or body text. Not persisted on the meeting in this slice.</summary>
    public string? Details { get; init; }

    public string? JoinUrl { get; init; }

    public string? OrganizerDisplayName { get; init; }

    public IReadOnlyList<string> AttendeeDisplayNames { get; init; } = [];

    /// <summary>
    /// True when the calendar owner organized the meeting.
    /// Windows <c>Appointment.Invitees</c> does not include the organizer, so the owner is not in
    /// <see cref="AttendeeDisplayNames"/> when this is true.
    /// </summary>
    public bool OrganizedByCurrentUser { get; init; }

    /// <summary>
    /// True when <see cref="AttendeeDisplayNames"/> already contains the calendar owner.
    /// The Windows store copies invitees and does not insert the owner. See <c>CalendarReminder</c>.
    /// </summary>
    public bool AttendeesIncludeCurrentUser { get; init; }

    /// <summary>Stable series id when the calendar API provided one. Null for one-off events.</summary>
    public string? SeriesId { get; init; }

    public CalendarBusyStatus BusyStatus { get; init; }

    public bool IsAllDay { get; init; }

    public bool IsDeclined { get; init; }
}
