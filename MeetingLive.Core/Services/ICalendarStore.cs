using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Reads upcoming events from the machine calendar.
/// A missing permission or a missing package identity is a <see cref="CalendarStoreResult"/> failure, not an exception.
/// </summary>
public interface ICalendarStore
{
    /// <param name="disabledCalendarIds">
    /// Calendar ids to skip. Compared with the set's own comparer. An empty set keeps every calendar.
    /// </param>
    Task<CalendarStoreResult> GetUpcomingAsync(
        DateTimeOffset now,
        IReadOnlySet<string> disabledCalendarIds,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Calendars the user can show or hide. A missing permission is a <see cref="CalendarListResult"/> failure, not an exception.
    /// Ids match the values <see cref="GetUpcomingAsync"/> skips.
    /// </summary>
    Task<CalendarListResult> GetCalendarsAsync(CancellationToken cancellationToken = default);
}
