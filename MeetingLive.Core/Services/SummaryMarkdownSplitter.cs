using System.Text.RegularExpressions;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Splits a summary provider's raw response into the Markdown summary body and the parsed
/// action item checklist. Every provider is asked (via its prompt) to emit a "## Summary" /
/// "## Action Items" shape, but the split is tolerant of a model that skips the headers:
/// if no "## Action Items" header is found, everything before the first "- [ ]" / "- [x]"
/// checkbox line is treated as the summary instead.
/// </summary>
internal static class SummaryMarkdownSplitter
{
    private const string SummaryHeader = "## Summary";
    private const string ActionItemsHeader = "## Action Items";
    private static readonly Regex ActionItemLine = new(@"^\s*-\s\[( |x|X)\]\s+", RegexOptions.Compiled);

    public static (string SummaryMarkdown, IReadOnlyList<ActionItem> ActionItems) Split(string rawResponse)
    {
        var lines = rawResponse.Replace("\r\n", "\n").Split('\n');

        var splitIndex = Array.FindIndex(lines, line => line.Trim() == ActionItemsHeader);
        if (splitIndex < 0)
            splitIndex = Array.FindIndex(lines, ActionItemLine.IsMatch);

        string summaryMarkdown;
        IReadOnlyList<ActionItem> actionItems;

        if (splitIndex < 0)
        {
            summaryMarkdown = rawResponse.Trim();
            actionItems = [];
        }
        else
        {
            summaryMarkdown = string.Join('\n', lines[..splitIndex]).Trim();
            actionItems = ActionItemParser.Parse(string.Join('\n', lines[splitIndex..]));
        }

        if (summaryMarkdown.StartsWith(SummaryHeader, StringComparison.Ordinal))
            summaryMarkdown = summaryMarkdown[SummaryHeader.Length..].Trim();

        return (summaryMarkdown, actionItems);
    }
}
