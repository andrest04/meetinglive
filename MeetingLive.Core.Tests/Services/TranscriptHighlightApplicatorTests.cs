using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptHighlightApplicatorTests
{
    [Fact]
    public void Apply_WhenNoHighlights_ReturnsTranscriptUnchanged()
    {
        const string transcript = "[00:00.00-00:02.00] hello";

        Assert.Equal(transcript, TranscriptHighlightApplicator.Apply(transcript, []));
    }

    [Fact]
    public void Apply_WhenTranscriptEmpty_WritesMarkLines()
    {
        var marks = new[] { TimeSpan.FromSeconds(12.4) };

        var actual = TranscriptHighlightApplicator.Apply(string.Empty, marks);

        Assert.Equal("* 00:12.40", actual);
    }

    [Fact]
    public void Apply_WhenMarkFallsInsideLine_PrefixesThatLine()
    {
        var transcript =
            "Recorded 2026-09-16 00:00\n" +
            "[00:00.00-00:05.00] hello there\n" +
            "[00:05.00-00:09.00] later";

        var actual = TranscriptHighlightApplicator.Apply(transcript, [TimeSpan.FromSeconds(2)]);

        Assert.Equal(
            "Recorded 2026-09-16 00:00\n" +
            "* [00:00.00-00:05.00] hello there\n" +
            "[00:05.00-00:09.00] later",
            actual);
    }

    [Fact]
    public void Apply_WhenLineAlreadyMarked_DoesNotDoublePrefix()
    {
        const string transcript = "* [00:00.00-00:05.00] hello there";

        var actual = TranscriptHighlightApplicator.Apply(transcript, [TimeSpan.FromSeconds(1)]);

        Assert.Equal(transcript, actual);
    }

    [Fact]
    public void Apply_WhenMarkIsBetweenLines_StarsThePreviousLine()
    {
        var transcript =
            "[00:00.00-00:01.00] first\n" +
            "[00:05.00-00:06.00] second";

        var actual = TranscriptHighlightApplicator.Apply(transcript, [TimeSpan.FromSeconds(3)]);

        Assert.Equal(
            "* [00:00.00-00:01.00] first\n" +
            "[00:05.00-00:06.00] second",
            actual);
    }

    [Fact]
    public void Apply_WhenTwoMarksHitTheSameLine_StarsOnce()
    {
        const string transcript = "[00:00.00-00:10.00] long turn";

        var actual = TranscriptHighlightApplicator.Apply(
            transcript,
            [TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(8)]);

        Assert.Equal("* [00:00.00-00:10.00] long turn", actual);
    }
}
