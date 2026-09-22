using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CalendarJoinUrlTests
{
    [Fact]
    public void Resolve_OnlineMeetingLinkPresent_PrefersIt()
    {
        var url = CalendarJoinUrl.Resolve(
            "https://teams.example/join",
            "https://other.example/uri",
            "Room https://location.example/x",
            "https://details.example/y");

        Assert.Equal("https://teams.example/join", url);
    }

    [Fact]
    public void Resolve_NoDedicatedLink_UsesFirstHttpsInLocation()
    {
        var url = CalendarJoinUrl.Resolve(null, null, "See https://meet.example/abc today", "https://ignored.example");

        Assert.Equal("https://meet.example/abc", url);
    }

    [Fact]
    public void Resolve_NoHttpsUrl_ReturnsNull()
    {
        var url = CalendarJoinUrl.Resolve(null, null, "Conference room 4", "Bring the agenda");

        Assert.Null(url);
    }

    [Fact]
    public void FromRecurrence_RecurringWithRoamingId_UsesRoamingId()
    {
        var seriesId = CalendarSeriesId.FromRecurrence(isRecurring: true, roamingId: " series-9 ");

        Assert.Equal("series-9", seriesId);
    }

    [Fact]
    public void FromRecurrence_NotRecurring_LeavesSeriesIdNull()
    {
        var seriesId = CalendarSeriesId.FromRecurrence(isRecurring: false, roamingId: "series-9");

        Assert.Null(seriesId);
    }
}
