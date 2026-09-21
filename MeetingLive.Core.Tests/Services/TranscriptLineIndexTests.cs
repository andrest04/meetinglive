using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class TranscriptLineIndexTests
{
    [Fact]
    public void Parse_NonEmptyLines_AssignsSequentialL000Ids()
    {
        var lines = TranscriptLineIndex.Parse("Alice will send the doc.\nThanks.\n");

        Assert.Equal(2, lines.Count);
        Assert.Equal("L000", lines[0].Id);
        Assert.Equal(0, lines[0].Index);
        Assert.Equal("Alice will send the doc.", lines[0].Text);
        Assert.Equal("L001", lines[1].Id);
        Assert.Equal(1, lines[1].Index);
        Assert.Equal("Thanks.", lines[1].Text);
        Assert.Equal(255, TranscriptLineIndex.MaxChoiceOptions);
    }

    [Fact]
    public void Parse_SkipsBlankLinesAndTrims_SplitsCrLf()
    {
        var lines = TranscriptLineIndex.Parse("  first  \r\n\r\n\n  second  \r\n   \n");

        Assert.Equal(2, lines.Count);
        Assert.Equal("L000", lines[0].Id);
        Assert.Equal("first", lines[0].Text);
        Assert.Equal("L001", lines[1].Id);
        Assert.Equal("second", lines[1].Text);
    }

    [Fact]
    public void Parse_WhenEmptyOrWhitespace_ReturnsNoLines()
    {
        Assert.Empty(TranscriptLineIndex.Parse(null));
        Assert.Empty(TranscriptLineIndex.Parse(""));
        Assert.Empty(TranscriptLineIndex.Parse("   \n\n  "));
    }

    [Fact]
    public void BuildTaggedDocument_PrefixesIdsWithPipe()
    {
        var lines = TranscriptLineIndex.Parse("Who owns this?\nAna will send it.");

        var tagged = TranscriptLineIndex.BuildTaggedDocument(lines);

        Assert.Equal("L000| Who owns this?\nL001| Ana will send it.", tagged);
    }
}
