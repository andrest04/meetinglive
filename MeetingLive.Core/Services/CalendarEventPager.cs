using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>Five events per page. The page index is clamped into range.</summary>
public static class CalendarEventPager
{
    public const int PageSize = 5;

    public static CalendarEventPage GetPage(IReadOnlyList<CalendarEvent> events, int pageIndex)
    {
        ArgumentNullException.ThrowIfNull(events);
        var pageCount = events.Count == 0 ? 1 : (int)Math.Ceiling(events.Count / (double)PageSize);
        var clamped = Math.Clamp(pageIndex, 0, pageCount - 1);
        var start = clamped * PageSize;
        var items = events.Skip(start).Take(PageSize).ToArray();
        return new CalendarEventPage(
            items,
            clamped,
            hasPrevious: clamped > 0,
            hasNext: start + PageSize < events.Count);
    }
}

public sealed class CalendarEventPage
{
    public CalendarEventPage(
        IReadOnlyList<CalendarEvent> items,
        int pageIndex,
        bool hasPrevious,
        bool hasNext)
    {
        Items = items;
        PageIndex = pageIndex;
        HasPrevious = hasPrevious;
        HasNext = hasNext;
    }

    public IReadOnlyList<CalendarEvent> Items { get; }

    public int PageIndex { get; }

    public bool HasPrevious { get; }

    public bool HasNext { get; }
}
