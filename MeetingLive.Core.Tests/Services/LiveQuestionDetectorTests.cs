using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveQuestionDetectorTests
{
    [Fact]
    public void TryDetectNew_WhenNewSpanishQuestion_ReturnsBody()
    {
        var recorded = TranscriptStampFormatter.FormatHeader(new DateTimeOffset(2026, 9, 21, 15, 0, 0, TimeSpan.Zero));
        var ended = TranscriptStampFormatter.FormatEnded(new DateTimeOffset(2026, 9, 21, 16, 0, 0, TimeSpan.Zero));
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(8),
            "¿Cuál es el tercer principio del manifiesto ágil?");
        var current = string.Join("\n", recorded, ended, line);

        var detected = LiveQuestionDetector.TryDetectNew(null, current);

        Assert.Equal("¿Cuál es el tercer principio del manifiesto ágil?", detected);
    }

    [Fact]
    public void TryDetectNew_WhenSameQuestionAlreadyCommitted_ReturnsNull()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(8),
            "¿Cuál es el tercer principio del manifiesto ágil?");

        var detected = LiveQuestionDetector.TryDetectNew(line, line);

        Assert.Null(detected);
    }

    [Fact]
    public void TryDetectNew_WhenEnglishAgileQuestion_ReturnsBody()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(12),
            TimeSpan.FromSeconds(20),
            "what is the third principle of the agile manifesto?");

        var detected = LiveQuestionDetector.TryDetectNew(string.Empty, line);

        Assert.Equal("what is the third principle of the agile manifesto?", detected);
    }

    [Theory]
    [InlineData("¿se entiende?")]
    [InlineData("¿ok?")]
    [InlineData("right?")]
    [InlineData("does that make sense?")]
    public void TryDetectNew_WhenRhetoricalCheck_ReturnsNull(string phrase)
    {
        var line = TranscriptStampFormatter.FormatLine(TimeSpan.Zero, TimeSpan.FromSeconds(3), phrase);

        var detected = LiveQuestionDetector.TryDetectNew(null, line);

        Assert.Null(detected);
    }

    [Fact]
    public void TryDetectNew_WhenNormalizedBodyShorterThanTwelveCharacters_ReturnsNull()
    {
        var line = TranscriptStampFormatter.FormatLine(TimeSpan.Zero, TimeSpan.FromSeconds(2), "¿qué hora?");

        var detected = LiveQuestionDetector.TryDetectNew(null, line);

        Assert.Null(detected);
    }

    [Fact]
    public void TryDetectNew_WhenSpeakerTagPresent_ReturnsBodyWithoutTag()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(4),
            TimeSpan.FromSeconds(9),
            "¿Cuál es el tercer principio del manifiesto ágil?",
            speakerTag: 2);

        var detected = LiveQuestionDetector.TryDetectNew(null, line);

        Assert.Equal("¿Cuál es el tercer principio del manifiesto ágil?", detected);
        Assert.DoesNotContain("Speaker", detected, StringComparison.Ordinal);
    }

    [Fact]
    public void TryDetectNew_WhenRecordedOrEndedHeader_IgnoresHeader()
    {
        var recorded = "Recorded what is the third principle of the agile manifesto?";
        var ended = "Ended what is the third principle of the agile manifesto?";

        Assert.Null(LiveQuestionDetector.TryDetectNew(null, recorded));
        Assert.Null(LiveQuestionDetector.TryDetectNew(null, ended));
    }

    [Fact]
    public void TryDetectNew_WhenSeveralQuestions_ReturnsLast()
    {
        var first = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(4),
            "what is the first principle of the agile manifesto?");
        var second = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(5),
            TimeSpan.FromSeconds(9),
            "what is the third principle of the agile manifesto?");
        var current = first + "\n" + second;

        var detected = LiveQuestionDetector.TryDetectNew(null, current);

        Assert.Equal("what is the third principle of the agile manifesto?", detected);
    }

    [Fact]
    public void TryDetectNew_WhenRhetoricalWordIsOnlyPartOfBody_ReturnsBody()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(7),
            "¿no es ese el tercer principio del manifiesto ágil?");

        var detected = LiveQuestionDetector.TryDetectNew(null, line);

        Assert.Equal("¿no es ese el tercer principio del manifiesto ágil?", detected);
    }

    [Fact]
    public void TryDetectNew_WhenLineStartsWithInterrogative_ReturnsBody()
    {
        var english = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(6),
            "what is the third principle of the agile manifesto");
        var spanish = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(7),
            TimeSpan.FromSeconds(12),
            "por qué es importante el tercer principio del manifiesto");

        Assert.Equal(
            "what is the third principle of the agile manifesto",
            LiveQuestionDetector.TryDetectNew(null, english));
        Assert.Equal(
            "por qué es importante el tercer principio del manifiesto",
            LiveQuestionDetector.TryDetectNew(null, spanish));
    }

    [Fact]
    public void TryDetectNew_WhenLineStartsWithPorque_ReturnsNull()
    {
        var line = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(6),
            "Porque el manifiesto ágil prioriza software funcionando");

        var detected = LiveQuestionDetector.TryDetectNew(null, line);

        Assert.Null(detected);
    }

    [Fact]
    public void TryDetectNew_WhenNullEmptyOrUnchanged_ReturnsNull()
    {
        var statement = TranscriptStampFormatter.FormatLine(
            TimeSpan.Zero,
            TimeSpan.FromSeconds(3),
            "the third principle is deliver working software");

        Assert.Null(LiveQuestionDetector.TryDetectNew(null, null));
        Assert.Null(LiveQuestionDetector.TryDetectNew(string.Empty, string.Empty));
        Assert.Null(LiveQuestionDetector.TryDetectNew(statement, statement));
        Assert.Null(LiveQuestionDetector.TryDetectNew(null, statement));
        Assert.Null(LiveQuestionDetector.TryDetectNew(null, "[not-a-stamp\n¿\n???"));
    }
}
