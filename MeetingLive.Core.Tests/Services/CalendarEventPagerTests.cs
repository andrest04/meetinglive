using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CalendarEventPagerTests
{
    [Fact]
    public void GetPage_EmptyList_ClampsToFirstPageWithNoNeighbors()
    {
        var page = CalendarEventPager.GetPage([], pageIndex: 4);

        Assert.Empty(page.Items);
        Assert.Equal(0, page.PageIndex);
        Assert.False(page.HasPrevious);
        Assert.False(page.HasNext);
    }

    [Fact]
    public void GetPage_ExactlyOnePage_HasNoNext()
    {
        var page = CalendarEventPager.GetPage(Events(5), pageIndex: 0);

        Assert.Equal(5, page.Items.Count);
        Assert.False(page.HasPrevious);
        Assert.False(page.HasNext);
    }

    [Fact]
    public void GetPage_SixEvents_FirstPageHasNextAndFiveItems()
    {
        var page = CalendarEventPager.GetPage(Events(6), pageIndex: 0);

        Assert.Equal(5, page.Items.Count);
        Assert.Equal("event-0", page.Items[0].EventId);
        Assert.False(page.HasPrevious);
        Assert.True(page.HasNext);
    }

    [Fact]
    public void GetPage_SixEvents_SecondPageHasPreviousAndOneItem()
    {
        var page = CalendarEventPager.GetPage(Events(6), pageIndex: 1);

        var only = Assert.Single(page.Items);
        Assert.Equal("event-5", only.EventId);
        Assert.Equal(1, page.PageIndex);
        Assert.True(page.HasPrevious);
        Assert.False(page.HasNext);
    }

    [Fact]
    public void GetPage_IndexPastEnd_ClampsToLastPage()
    {
        var page = CalendarEventPager.GetPage(Events(6), pageIndex: 9);

        Assert.Equal(1, page.PageIndex);
        Assert.True(page.HasPrevious);
        Assert.False(page.HasNext);
    }

    [Fact]
    public void GetPage_NegativeIndex_ClampsToFirstPage()
    {
        var page = CalendarEventPager.GetPage(Events(6), pageIndex: -3);

        Assert.Equal(0, page.PageIndex);
        Assert.False(page.HasPrevious);
        Assert.True(page.HasNext);
    }

    private static CalendarEvent[] Events(int count) =>
        Enumerable.Range(0, count).Select(index => new CalendarEvent
        {
            EventId = $"event-{index}",
            CalendarId = "cal-1",
            CalendarName = "Work",
            Subject = $"Meeting {index}",
            Start = DateTimeOffset.Parse("2026-09-21T15:00:00Z").AddHours(index),
            Duration = TimeSpan.FromMinutes(30),
            BusyStatus = CalendarBusyStatus.Busy,
        }).ToArray();
}
