namespace MeetingLive.Core.Models;

/// <summary>Upcoming events, or a typed failure. Never both a failure and a non-empty list.</summary>
public sealed class CalendarStoreResult
{
    private CalendarStoreResult(IReadOnlyList<CalendarEvent> events, CalendarStoreFailure? failure)
    {
        Events = events;
        Failure = failure;
    }

    public IReadOnlyList<CalendarEvent> Events { get; }

    public CalendarStoreFailure? Failure { get; }

    public static CalendarStoreResult FromEvents(IReadOnlyList<CalendarEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        return events.Count == 0
            ? new CalendarStoreResult([], CalendarStoreFailure.Empty)
            : new CalendarStoreResult(events, null);
    }

    public static CalendarStoreResult Failed(CalendarStoreFailure failure) =>
        new([], failure);
}
