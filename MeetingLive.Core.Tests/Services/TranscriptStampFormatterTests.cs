using System.Globalization;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptStampFormatterTests
{
    private static readonly DateTimeOffset RecordedAt = new(2026, 9, 2, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public void FormatHeader_UsesLocalRecordedStamp()
    {
        var expected = $"Recorded {RecordedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)}";

        Assert.Equal(expected, TranscriptStampFormatter.FormatHeader(RecordedAt));
    }

    [Fact]
    public void FormatLine_WhenRecordedAtIsDefault_OmitsClock()
    {
        var line = TranscriptStampFormatter.FormatLine(TimeSpan.FromSeconds(5), "Hello", default);

        Assert.Equal("[00:00:05] Hello", line);
    }

    [Fact]
    public void FormatLine_WhenRecordedAtIsSet_IncludesElapsedAndClock()
    {
        var start = TimeSpan.FromMinutes(5);
        var clock = (RecordedAt.ToLocalTime() + start).ToString("HH:mm", CultureInfo.InvariantCulture);

        var line = TranscriptStampFormatter.FormatLine(start, "after break", RecordedAt);

        Assert.Equal($"[00:05:00 | {clock}] after break", line);
    }

    [Fact]
    public void FormatLine_ClockSkew_ShiftsWallClockNotElapsed()
    {
        var start = TimeSpan.FromMinutes(5);
        var skew = TimeSpan.FromMinutes(15);
        var clock = (RecordedAt.ToLocalTime() + start + skew).ToString("HH:mm", CultureInfo.InvariantCulture);

        var line = TranscriptStampFormatter.FormatLine(start, "after break", RecordedAt, skew);

        Assert.Equal($"[00:05:00 | {clock}] after break", line);
    }

    [Fact]
    public void FormatLine_NegativeElapsed_ClampsToZero()
    {
        var line = TranscriptStampFormatter.FormatLine(TimeSpan.FromSeconds(-3), "Hi", default);

        Assert.Equal("[00:00:00] Hi", line);
    }
}
