using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveAnswerWindowTests
{
    [Fact]
    public void Default_IsNinetySeconds()
    {
        Assert.Equal(TimeSpan.FromSeconds(90), LiveAnswerWindow.Default);
    }

    [Fact]
    public void TakeRecent_WhenLineEndsInsideNinetySeconds_KeepsItAndDropsOlderLine()
    {
        var older = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(20),
            "older line outside the window");
        var justOutside = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(100),
            TimeSpan.FromSeconds(109),
            "line ending ninety one seconds before the latest");
        var boundary = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(105),
            TimeSpan.FromSeconds(110),
            "line ending exactly ninety seconds before the latest");
        var inside = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(115),
            TimeSpan.FromSeconds(130),
            "line ending inside the ninety second window");
        var latest = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(190),
            TimeSpan.FromSeconds(200),
            "latest line in the window");
        var transcript = string.Join("\n", older, justOutside, boundary, inside, latest);

        var window = LiveAnswerWindow.TakeRecent(transcript, TimeSpan.FromSeconds(90));

        Assert.Equal(string.Join("\n", boundary, inside, latest), window);
    }

    [Fact]
    public void TakeRecent_WhenUntimestampedLineSitsInsideSpan_KeepsItAndDropsHeaders()
    {
        var recorded = TranscriptStampFormatter.FormatHeader(new DateTimeOffset(2026, 9, 21, 15, 0, 0, TimeSpan.Zero));
        var ended = TranscriptStampFormatter.FormatEnded(new DateTimeOffset(2026, 9, 21, 16, 0, 0, TimeSpan.Zero));
        var older = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(20),
            "older line outside the window");
        var beforeSpan = "note before the window span";
        var recent = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(115),
            TimeSpan.FromSeconds(120),
            "recent line inside the window");
        var aside = "aside without a timestamp";
        var recordedDecoy = "Recorded 1999-01-01 00:00";
        var endedDecoy = "Ended 1999-01-01 00:05";
        var latest = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(190),
            TimeSpan.FromSeconds(200),
            "latest line inside the window");
        var afterSpan = "trailing note after the span";
        var transcript = string.Join(
            "\n",
            recorded,
            ended,
            older,
            beforeSpan,
            recent,
            aside,
            recordedDecoy,
            endedDecoy,
            latest,
            afterSpan);

        var window = LiveAnswerWindow.TakeRecent(transcript, TimeSpan.FromSeconds(90));

        Assert.Equal(string.Join("\n", recent, aside, latest), window);
    }

    [Fact]
    public void TakeRecent_WhenNoTimestampsParse_ReturnsLast2500Characters()
    {
        var transcript = new string('H', 100) + new string('T', 2500);

        var window = LiveAnswerWindow.TakeRecent(transcript, LiveAnswerWindow.Default);

        Assert.Equal(2500, window.Length);
        Assert.Equal(new string('T', 2500), window);
    }

    [Fact]
    public void TakeRecent_WhenNoTimestampsAndShorterThanFallback_ReturnsWholeTranscript()
    {
        const string transcript = "not a stamp at all";

        var window = LiveAnswerWindow.TakeRecent(transcript, TimeSpan.FromSeconds(90));

        Assert.Equal(transcript, window);
    }

    [Fact]
    public void TakeRecent_WhenTranscriptIsNullOrGarbage_DoesNotThrow()
    {
        const string garbage = "[not-a-stamp]\n[[[--]]\nhello";

        Assert.Equal(string.Empty, LiveAnswerWindow.TakeRecent(null, LiveAnswerWindow.Default));
        Assert.Equal(garbage, LiveAnswerWindow.TakeRecent(garbage, TimeSpan.FromSeconds(90)));
    }
}
