namespace MeetingLive.Core.Models;

/// <summary>One calendar the Settings page can show or hide. Not a WinRT calendar.</summary>
public sealed class CalendarListItem
{
    public required string Id { get; init; }

    public required string Name { get; init; }
}

/// <summary>Calendars on the machine, or a typed failure. Never both a failure and a non-empty list.</summary>
public sealed class CalendarListResult
{
    private CalendarListResult(IReadOnlyList<CalendarListItem> calendars, CalendarStoreFailure? failure)
    {
        Calendars = calendars;
        Failure = failure;
    }

    public IReadOnlyList<CalendarListItem> Calendars { get; }

    public CalendarStoreFailure? Failure { get; }

    public static CalendarListResult FromCalendars(IReadOnlyList<CalendarListItem> calendars)
    {
        ArgumentNullException.ThrowIfNull(calendars);
        return calendars.Count == 0
            ? new CalendarListResult([], CalendarStoreFailure.Empty)
            : new CalendarListResult(calendars, null);
    }

    public static CalendarListResult Failed(CalendarStoreFailure failure) =>
        new([], failure);
}
