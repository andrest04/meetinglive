using System.Reflection;

namespace MeetingLive.Core.Tests.Services;

/// <summary>
/// <c>SummaryMarkdownSplitter</c> is internal (only summary providers need it), so these
/// tests reach it via reflection rather than making it public just for testing.
/// </summary>
public class SummaryMarkdownSplitterTests
{
    private static (string SummaryMarkdown, IReadOnlyList<MeetingLive.Core.Models.ActionItem> ActionItems) Split(string rawResponse)
    {
        var splitterType = typeof(MeetingLive.Core.Services.ISummaryProvider).Assembly
            .GetType("MeetingLive.Core.Services.SummaryMarkdownSplitter")!;
        var method = splitterType.GetMethod("Split", BindingFlags.Public | BindingFlags.Static)!;
        var result = method.Invoke(null, [rawResponse])!;

        var resultType = result.GetType();
        var summaryMarkdown = (string)resultType.GetField("Item1")!.GetValue(result)!;
        var actionItems = (IReadOnlyList<MeetingLive.Core.Models.ActionItem>)resultType.GetField("Item2")!.GetValue(result)!;
        return (summaryMarkdown, actionItems);
    }

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

        var (summary, actionItems) = Split(raw);

        Assert.Equal("Key points discussed.", summary);
        Assert.Equal(2, actionItems.Count);
        Assert.Equal("Follow up with design", actionItems[0].Text);
        Assert.False(actionItems[0].IsDone);
        Assert.Equal("Send calendar invite", actionItems[1].Text);
        Assert.True(actionItems[1].IsDone);
    }

    [Fact]
    public void Split_WithoutHeaders_FallsBackToFirstCheckboxLine()
    {
        const string raw = """
            Key points discussed and decisions made.

            - [ ] Follow up with design
            """;

        var (summary, actionItems) = Split(raw);

        Assert.Equal("Key points discussed and decisions made.", summary);
        Assert.Single(actionItems);
        Assert.Equal("Follow up with design", actionItems[0].Text);
    }

    [Fact]
    public void Split_WithNoActionItemsAtAll_ReturnsWholeResponseAsSummary()
    {
        const string raw = "Just a plain prose summary, no checkboxes anywhere.";

        var (summary, actionItems) = Split(raw);

        Assert.Equal(raw, summary);
        Assert.Empty(actionItems);
    }

    [Fact]
    public void Split_WithEmptyActionItemsSection_ReturnsEmptyActionItemsList()
    {
        const string raw = """
            ## Summary

            Nothing much happened.

            ## Action Items

            """;

        var (summary, actionItems) = Split(raw);

        Assert.Equal("Nothing much happened.", summary);
        Assert.Empty(actionItems);
    }
}
