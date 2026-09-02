using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingSnippetTests
{
    [Fact]
    public void From_WhenSummaryPresent_PrefersSummaryOverTranscript()
    {
        var snippet = MeetingSnippet.From("### Notes\nShip it", "raw transcript");

        Assert.Equal("Notes Ship it", snippet);
    }

    [Fact]
    public void From_WhenSummaryMissing_UsesTranscript()
    {
        var snippet = MeetingSnippet.From("  ", "hello **world**");

        Assert.Equal("hello world", snippet);
    }

    [Fact]
    public void From_WhenBothEmpty_ReturnsEmpty()
    {
        Assert.Equal(string.Empty, MeetingSnippet.From(null, "   "));
    }

    [Fact]
    public void FromMarkdown_StripsAtxHeadingsEmphasisAndBackticks()
    {
        const string markdown = """
            ### What this was

            We agreed **to ship** the `_beta_` with `care`.
            """;

        var snippet = MeetingSnippet.FromMarkdown(markdown);

        Assert.Equal("What this was We agreed to ship the beta with care.", snippet);
    }

    [Fact]
    public void FromMarkdown_CollapsesWhitespace()
    {
        var snippet = MeetingSnippet.FromMarkdown("alpha \n\n\t  beta");

        Assert.Equal("alpha beta", snippet);
    }

    [Fact]
    public void FromMarkdown_TruncatesToMaxLengthWithEllipsis()
    {
        var markdown = new string('a', MeetingSnippet.MaxLength + 20);

        var snippet = MeetingSnippet.FromMarkdown(markdown);

        Assert.Equal(new string('a', MeetingSnippet.MaxLength) + "…", snippet);
    }

    [Fact]
    public void FromMarkdown_LeavesShortPlainTextUnchanged()
    {
        var snippet = MeetingSnippet.FromMarkdown("Standup notes");

        Assert.Equal("Standup notes", snippet);
    }
}
