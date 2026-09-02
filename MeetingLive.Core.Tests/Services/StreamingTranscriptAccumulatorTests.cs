using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class StreamingTranscriptAccumulatorTests
{
    [Fact]
    public void Apply_Interim_ReplacesPartialSuffix()
    {
        var accumulator = new StreamingTranscriptAccumulator();

        accumulator.Apply(Interim("hel"));
        accumulator.Apply(Interim("hello"));

        Assert.Equal("hello", accumulator.DisplayText);
        Assert.Equal(string.Empty, accumulator.CommittedText);
    }

    [Fact]
    public void Apply_Final_CommitsTimestampedLine()
    {
        var accumulator = new StreamingTranscriptAccumulator();
        var words = new[]
        {
            new NemoSpeechWordTiming(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1.4)),
            new NemoSpeechWordTiming(TimeSpan.FromSeconds(1.4), TimeSpan.FromSeconds(2)),
        };

        accumulator.Apply(new NemoSpeechAsrResult(true, "Hello there", 2, words));

        Assert.Equal("[00:00:01 -> 00:00:02] Hello there", accumulator.CommittedText);
        Assert.Equal(accumulator.CommittedText, accumulator.DisplayText);
    }

    [Fact]
    public void Apply_MixedSequence_CommitsFinalsAndReplacesInterim()
    {
        var accumulator = new StreamingTranscriptAccumulator();

        accumulator.Apply(Interim("hel"));
        accumulator.Apply(Final("Hello", TimeSpan.Zero, TimeSpan.FromSeconds(1)));
        accumulator.Apply(Interim("wor"));
        accumulator.Apply(Interim("world"));
        accumulator.Apply(Final("world", TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)));

        var expected =
            "[00:00:00 -> 00:00:01] Hello" + Environment.NewLine +
            "[00:00:01 -> 00:00:02] world";
        Assert.Equal(expected, accumulator.DisplayText);
        Assert.Equal(expected, accumulator.CommittedText);
    }

    [Fact]
    public void DisplayText_AfterFinal_ShowsCommittedPlusCurrentInterim()
    {
        var accumulator = new StreamingTranscriptAccumulator();
        accumulator.Apply(Final("Hello", TimeSpan.Zero, TimeSpan.FromSeconds(1)));
        accumulator.Apply(Interim("wor"));

        var expected = "[00:00:00 -> 00:00:01] Hello" + Environment.NewLine + "wor";
        Assert.Equal(expected, accumulator.DisplayText);
        Assert.Equal("[00:00:00 -> 00:00:01] Hello", accumulator.CommittedText);
    }

    [Fact]
    public void Apply_FinalWithoutWords_UsesAudioProcessed()
    {
        var accumulator = new StreamingTranscriptAccumulator();
        accumulator.Apply(new NemoSpeechAsrResult(true, "Hi", 3.2f, []));

        Assert.Equal("[00:00:00 -> 00:00:03] Hi", accumulator.CommittedText);
    }

    private static NemoSpeechAsrResult Interim(string text) =>
        new(false, text, 0, []);

    private static NemoSpeechAsrResult Final(string text, TimeSpan start, TimeSpan end) =>
        new(true, text, (float)end.TotalSeconds, [new NemoSpeechWordTiming(start, end)]);
}
