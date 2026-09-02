using System.Globalization;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class StreamingTranscriptAccumulatorTests
{
    private static readonly DateTimeOffset RecordedAt = new(2026, 9, 2, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Apply_Interim_ReplacesPartialSuffix()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);

        accumulator.Apply(Interim("hel"));
        accumulator.Apply(Interim("hello"));

        Assert.Equal("hello", accumulator.DisplayText);
        Assert.Equal(string.Empty, accumulator.CommittedText);
    }

    [Fact]
    public void Apply_Final_CommitsTimestampedLine()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);
        var words = new[]
        {
            new NemoSpeechWordTiming(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1.4)),
            new NemoSpeechWordTiming(TimeSpan.FromSeconds(1.4), TimeSpan.FromSeconds(2)),
        };

        accumulator.Apply(new NemoSpeechAsrResult(true, "Hello there", 2, words));

        var expected = Header() + Environment.NewLine + Line(TimeSpan.FromSeconds(1), "Hello there");
        Assert.Equal(expected, accumulator.CommittedText);
        Assert.Equal(accumulator.CommittedText, accumulator.DisplayText);
    }

    [Fact]
    public void Apply_ShortFinal_StaysOneLineWithClock()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);
        var words = Enumerable.Range(0, 5)
            .Select(i => new NemoSpeechWordTiming(TimeSpan.FromSeconds(i * 4), TimeSpan.FromSeconds((i + 1) * 4)))
            .ToArray();

        accumulator.Apply(new NemoSpeechAsrResult(true, "short window stays together", 20, words));

        var expected = Header() + Environment.NewLine + Line(TimeSpan.Zero, "short window stays together");
        Assert.Equal(expected, accumulator.CommittedText);
        Assert.DoesNotContain("->", accumulator.CommittedText, StringComparison.Ordinal);
    }

    [Fact]
    public void Apply_MixedSequence_CommitsFinalsAndReplacesInterim()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);

        accumulator.Apply(Interim("hel"));
        accumulator.Apply(Final("Hello", TimeSpan.Zero, TimeSpan.FromSeconds(1)));
        accumulator.Apply(Interim("wor"));
        accumulator.Apply(Interim("world"));
        accumulator.Apply(Final("world", TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)));

        var expected =
            Header() + Environment.NewLine +
            Line(TimeSpan.Zero, "Hello") + Environment.NewLine +
            Line(TimeSpan.FromSeconds(1), "world");
        Assert.Equal(expected, accumulator.DisplayText);
        Assert.Equal(expected, accumulator.CommittedText);
    }

    [Fact]
    public void DisplayText_AfterFinal_ShowsCommittedPlusCurrentInterim()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);
        accumulator.Apply(Final("Hello", TimeSpan.Zero, TimeSpan.FromSeconds(1)));
        accumulator.Apply(Interim("wor"));

        var expected = Header() + Environment.NewLine + Line(TimeSpan.Zero, "Hello") + Environment.NewLine + "wor";
        Assert.Equal(expected, accumulator.DisplayText);
        Assert.Equal(Header() + Environment.NewLine + Line(TimeSpan.Zero, "Hello"), accumulator.CommittedText);
    }

    [Fact]
    public void Apply_FinalWithoutWords_UsesAudioProcessed()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);
        accumulator.Apply(new NemoSpeechAsrResult(true, "Hi", 3.2f, []));

        var expected = Header() + Environment.NewLine + Line(TimeSpan.Zero, "Hi");
        Assert.Equal(expected, accumulator.CommittedText);
    }

    [Fact]
    public void Apply_ClockSkew_ShiftsWallClockNotElapsed()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt)
        {
            ClockSkew = TimeSpan.FromMinutes(15),
        };
        accumulator.Apply(Final("after break", TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5.5)));

        var expected = Header() + Environment.NewLine +
            Line(TimeSpan.FromMinutes(5), "after break", TimeSpan.FromMinutes(15));
        Assert.Equal(expected, accumulator.CommittedText);
        Assert.Contains("[00:05:00 |", accumulator.CommittedText, StringComparison.Ordinal);
    }

    [Fact]
    public void Apply_WhenRecordedAtIsDefault_OmitsClockAndHeader()
    {
        var accumulator = new StreamingTranscriptAccumulator(default);
        accumulator.Apply(Final("Hello", TimeSpan.Zero, TimeSpan.FromSeconds(1)));

        Assert.Equal("[00:00:00] Hello", accumulator.CommittedText);
        Assert.DoesNotContain("Recorded ", accumulator.CommittedText, StringComparison.Ordinal);
        Assert.DoesNotContain("|", accumulator.CommittedText, StringComparison.Ordinal);
    }

    [Fact]
    public void Apply_LongFinal_SplitsIntoThirtySecondWindows()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);
        var tokens = new[] { "one", "two", "three", "four", "five", "six", "seven", "eight", "nine" };
        var words = tokens
            .Select((_, i) => new NemoSpeechWordTiming(TimeSpan.FromSeconds(i * 10), TimeSpan.FromSeconds((i + 1) * 10)))
            .ToArray();

        accumulator.Apply(new NemoSpeechAsrResult(true, string.Join(" ", tokens), 90, words));

        var expected =
            Header() + Environment.NewLine +
            Line(TimeSpan.Zero, "one two") + Environment.NewLine +
            Line(TimeSpan.FromSeconds(20), "three four") + Environment.NewLine +
            Line(TimeSpan.FromSeconds(40), "five six") + Environment.NewLine +
            Line(TimeSpan.FromSeconds(60), "seven eight") + Environment.NewLine +
            Line(TimeSpan.FromSeconds(80), "nine");
        Assert.Equal(expected, accumulator.CommittedText);
        Assert.DoesNotContain("onetwo", accumulator.CommittedText, StringComparison.Ordinal);
    }

    [Fact]
    public void Apply_LongFinal_ExtraTokens_AppendToLastWindow()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);
        var words = new[]
        {
            new NemoSpeechWordTiming(TimeSpan.Zero, TimeSpan.FromSeconds(10)),
            new NemoSpeechWordTiming(TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(20)),
            new NemoSpeechWordTiming(TimeSpan.FromSeconds(20), TimeSpan.FromSeconds(30)),
            new NemoSpeechWordTiming(TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(40)),
        };

        accumulator.Apply(new NemoSpeechAsrResult(true, "a b c d extra leftover", 40, words));

        var expected =
            Header() + Environment.NewLine +
            Line(TimeSpan.Zero, "a b") + Environment.NewLine +
            Line(TimeSpan.FromSeconds(20), "c d extra leftover");
        Assert.Equal(expected, accumulator.CommittedText);
    }

    [Fact]
    public void Apply_LongFinal_SingleToken_DoesNotSplitMidWord()
    {
        var accumulator = new StreamingTranscriptAccumulator(RecordedAt);
        var words = new[]
        {
            new NemoSpeechWordTiming(TimeSpan.Zero, TimeSpan.FromSeconds(90)),
        };

        accumulator.Apply(new NemoSpeechAsrResult(true, "supercalifragilistic", 90, words));

        var expected = Header() + Environment.NewLine + Line(TimeSpan.Zero, "supercalifragilistic");
        Assert.Equal(expected, accumulator.CommittedText);
    }

    private static string Header()
    {
        var stamp = RecordedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        return $"Recorded {stamp}";
    }

    private static string Line(TimeSpan start, string text, TimeSpan clockSkew = default)
    {
        var elapsed = start.ToString(@"hh\:mm\:ss");
        var clock = (RecordedAt.ToLocalTime() + start + clockSkew).ToString("HH:mm", CultureInfo.InvariantCulture);
        return $"[{elapsed} | {clock}] {text}";
    }

    private static NemoSpeechAsrResult Interim(string text) =>
        new(false, text, 0, []);

    private static NemoSpeechAsrResult Final(string text, TimeSpan start, TimeSpan end) =>
        new(true, text, (float)end.TotalSeconds, [new NemoSpeechWordTiming(start, end)]);
}
