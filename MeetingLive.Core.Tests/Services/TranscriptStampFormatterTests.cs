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
    public void FormatLine_WhenSpeakerTagIsZero_OmitsSpeakerBracket()
    {
        var start = TimeSpan.FromMilliseconds(1120);
        var end = TimeSpan.FromMilliseconds(5360);

        var line = TranscriptStampFormatter.FormatLine(start, end, "hello there");

        Assert.Equal("[00:01.12-00:05.36] hello there", line);
    }

    [Fact]
    public void FormatLine_WhenSpeakerTagIsPositive_IncludesSpeakerBracket()
    {
        var start = TimeSpan.FromMilliseconds(1120);
        var end = TimeSpan.FromMilliseconds(5360);

        var line = TranscriptStampFormatter.FormatLine(
            start,
            end,
            "Hey there, we heard you've got a new burger on the menu.",
            speakerTag: 1);

        Assert.Equal(
            "[00:01.12-00:05.36] [ Speaker-1 ] Hey there, we heard you've got a new burger on the menu.",
            line);
    }

    [Fact]
    public void FormatLine_NegativeElapsed_ClampsToZero()
    {
        var line = TranscriptStampFormatter.FormatLine(TimeSpan.FromSeconds(-3), TimeSpan.FromSeconds(-1), "Hi");

        Assert.Equal("[00:00.00-00:00.00] Hi", line);
    }

    [Fact]
    public void FormatLine_WhenEndIsBeforeStart_UsesStartForEnd()
    {
        var start = TimeSpan.FromSeconds(5);

        var line = TranscriptStampFormatter.FormatLine(start, TimeSpan.FromSeconds(2), "Hi");

        Assert.Equal("[00:05.00-00:05.00] Hi", line);
    }

    [Fact]
    public void FormatLine_WhenMinutesExceed59_KeepsTotalMinutes()
    {
        var start = TimeSpan.FromMinutes(90);
        var end = TimeSpan.FromMinutes(90) + TimeSpan.FromMilliseconds(1120);

        var line = TranscriptStampFormatter.FormatLine(start, end, "long meeting");

        Assert.Equal("[90:00.00-90:01.12] long meeting", line);
    }

    [Fact]
    public void FormatEnded_UsesLocalEndedStamp()
    {
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);
        var expected = $"Ended {endedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)}";

        Assert.Equal(expected, TranscriptStampFormatter.FormatEnded(endedAt));
    }

    [Fact]
    public void EnsureEndedHeader_WhenRecordedHeaderExists_InsertsEndedAsSecondLine()
    {
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);
        var recorded = TranscriptStampFormatter.FormatHeader(RecordedAt);
        var ended = TranscriptStampFormatter.FormatEnded(endedAt);
        var transcript = recorded + "\r\n[00:00:01 | 15:00] Hello";

        var result = TranscriptStampFormatter.EnsureEndedHeader(transcript, RecordedAt, endedAt);

        Assert.Equal(recorded + "\r\n" + ended + "\r\n[00:00:01 | 15:00] Hello", result);
    }

    [Fact]
    public void EnsureEndedHeader_WhenEndedHeaderExists_ReplacesSecondLine()
    {
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);
        var recorded = TranscriptStampFormatter.FormatHeader(RecordedAt);
        var ended = TranscriptStampFormatter.FormatEnded(endedAt);
        var transcript = recorded + "\nEnded 1999-01-01 00:00\n[00:00:01 | 15:00] Hello";

        var result = TranscriptStampFormatter.EnsureEndedHeader(transcript, RecordedAt, endedAt);

        Assert.Equal(recorded + "\n" + ended + "\n[00:00:01 | 15:00] Hello", result);
    }

    [Fact]
    public void EnsureEndedHeader_WhenCalledTwice_DoesNotDuplicateEnded()
    {
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);
        var recorded = TranscriptStampFormatter.FormatHeader(RecordedAt);
        var transcript = recorded + "\n[00:00:01 | 15:00] Hello";

        var once = TranscriptStampFormatter.EnsureEndedHeader(transcript, RecordedAt, endedAt);
        var twice = TranscriptStampFormatter.EnsureEndedHeader(once, RecordedAt, endedAt);

        Assert.Equal(once, twice);
        Assert.Equal(1, CountOccurrences(twice, "Ended "));
    }

    [Fact]
    public void EnsureEndedHeader_WhenTimestampsAreDefault_ReturnsTranscriptUnchanged()
    {
        const string transcript = "Recorded 2026-09-02 15:00\n[00:00:01 | 15:00] Hello";
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);

        Assert.Same(transcript, TranscriptStampFormatter.EnsureEndedHeader(transcript, default, endedAt));
        Assert.Same(transcript, TranscriptStampFormatter.EnsureEndedHeader(transcript, RecordedAt, default));
        Assert.Same(string.Empty, TranscriptStampFormatter.EnsureEndedHeader(string.Empty, RecordedAt, endedAt));
    }

    [Fact]
    public void EnsureEndedHeader_WhenRecordedHeaderIsMissing_PrependsRecordedAndEnded()
    {
        var endedAt = new DateTimeOffset(2026, 9, 2, 16, 30, 0, TimeSpan.Zero);
        const string transcript = "[00:00:01 | 15:00] Hello";
        var expected =
            TranscriptStampFormatter.FormatHeader(RecordedAt) + "\n" +
            TranscriptStampFormatter.FormatEnded(endedAt) + "\n" +
            transcript;

        var result = TranscriptStampFormatter.EnsureEndedHeader(transcript, RecordedAt, endedAt);

        Assert.Equal(expected, result);
    }

    private static int CountOccurrences(string text, string value)
    {
        var count = 0;
        for (var index = 0; (index = text.IndexOf(value, index, StringComparison.Ordinal)) >= 0; index += value.Length)
            count++;
        return count;
    }
}
