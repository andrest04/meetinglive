using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class SummaryMarkdownSplitterTests
{
    [Fact]
    public void Split_WithBothHeaders_SeparatesSummaryFromActionItems()
    {
        const string raw = """
            ## Summary

            Key points discussed.

            ## Action Items

            - [ ] Follow up with design
            - [x] Send calendar invite
            """;

        var (summary, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Equal("Key points discussed.", summary);
        Assert.Equal(2, actionItems.Count);
        Assert.Equal("Follow up with design", actionItems[0].Text);
        Assert.False(actionItems[0].IsDone);
        Assert.Equal("Send calendar invite", actionItems[1].Text);
        Assert.True(actionItems[1].IsDone);
        Assert.Null(suggestedTitle);
    }

    [Fact]
    public void Split_WithoutHeaders_FallsBackToFirstCheckboxLine()
    {
        const string raw = """
            Key points discussed and decisions made.

            - [ ] Follow up with design
            """;

        var (summary, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Equal("Key points discussed and decisions made.", summary);
        Assert.Single(actionItems);
        Assert.Equal("Follow up with design", actionItems[0].Text);
        Assert.Null(suggestedTitle);
    }

    [Fact]
    public void Split_WithNoActionItemsAtAll_ReturnsWholeResponseAsSummary()
    {
        const string raw = "Just a plain prose summary, no checkboxes anywhere.";

        var (summary, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Equal(raw, summary);
        Assert.Empty(actionItems);
        Assert.Null(suggestedTitle);
    }

    [Fact]
    public void Split_WithEmptyActionItemsSection_ReturnsEmptyActionItemsList()
    {
        const string raw = """
            ## Summary

            Nothing much happened.

            ## Action Items

            """;

        var (summary, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Equal("Nothing much happened.", summary);
        Assert.Empty(actionItems);
        Assert.Null(suggestedTitle);
    }

    [Fact]
    public void Split_WithTitleSummaryAndActionItems_ExtractsTitleAndStripsItFromBody()
    {
        const string raw = """
            ## Title

            Q3 planning with Ana

            ## Summary

            Key points discussed.

            ## Action Items

            - [ ] Follow up with design
            """;

        var (summary, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Equal("Q3 planning with Ana", suggestedTitle);
        Assert.Equal("Key points discussed.", summary);
        Assert.DoesNotContain("## Title", summary, StringComparison.Ordinal);
        Assert.DoesNotContain("Q3 planning with Ana", summary, StringComparison.Ordinal);
        Assert.Single(actionItems);
        Assert.Equal("Follow up with design", actionItems[0].Text);
    }

    [Fact]
    public void Split_WhenTitleIsMissing_SuggestedTitleIsNullAndTwoHeaderBodyUnchanged()
    {
        const string raw = """
            ## Summary

            Kickoff meeting.

            ## Action Items

            - [ ] Send the invite
            """;

        var (summary, actionItems, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Null(suggestedTitle);
        Assert.Equal("Kickoff meeting.", summary);
        Assert.Single(actionItems);
        Assert.Equal("Send the invite", actionItems[0].Text);
    }

    [Fact]
    public void Split_WhenTitleHasExtraBlankLines_JoinsNonEmptyLines()
    {
        const string raw = """
            ## Title


            Q3 planning
            with Ana


            ## Summary

            Notes from the room.
            """;

        var (summary, _, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Equal("Q3 planning with Ana", suggestedTitle);
        Assert.Equal("Notes from the room.", summary);
    }

    [Fact]
    public void Split_WhenTitleHasWrappingQuotes_KeepsQuotesForNormalize()
    {
        const string raw = """
            ## Title

            "Microphone test"

            ## Summary

            Informal ASR check.
            """;

        var (summary, _, suggestedTitle) = SummaryMarkdownSplitter.Split(raw);

        Assert.Equal("\"Microphone test\"", suggestedTitle);
        Assert.Equal("Informal ASR check.", summary);
    }
}
