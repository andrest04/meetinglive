using System.Text.RegularExpressions;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Splits a summary provider's raw response into the Markdown summary body, the parsed
/// action item checklist, and an optional suggested title. Every provider is asked (via
/// its prompt) to emit a "## Title" / "## Summary" / "## Action Items" shape, but the
/// split is tolerant of a model that skips headers: a missing "## Title" leaves
/// <c>SuggestedTitle</c> null, and if no "## Action Items" header is found, everything
/// before the first "- [ ]" / "- [x]" checkbox line is treated as the summary instead.
/// </summary>
internal static partial class SummaryMarkdownSplitter
{
    private const string TitleHeader = "## Title";
    private const string SummaryHeader = "## Summary";
    private const string ActionItemsHeader = "## Action Items";

    [GeneratedRegex(@"^\s*-\s\[( |x|X)\]\s+", RegexOptions.CultureInvariant)]
    private static partial Regex ActionItemLine();

    public static (string SummaryMarkdown, IReadOnlyList<ActionItem> ActionItems, string? SuggestedTitle) Split(string rawResponse)
    {
        var lines = rawResponse.Replace("\r\n", "\n").Split('\n');
        var suggestedTitle = ExtractSuggestedTitle(lines);

        var splitIndex = Array.FindIndex(lines, line => line.Trim() == ActionItemsHeader);
        if (splitIndex < 0)
            splitIndex = Array.FindIndex(lines, static line => ActionItemLine().IsMatch(line));

        string[] summaryLines = splitIndex < 0 ? lines : lines[..splitIndex];
        IReadOnlyList<ActionItem> actionItems = splitIndex < 0
            ? []
            : ActionItemParser.Parse(string.Join('\n', lines[splitIndex..]));

        summaryLines = StripTitleBlock(summaryLines);
        var summaryMarkdown = string.Join('\n', summaryLines).Trim();

        if (summaryMarkdown.StartsWith(SummaryHeader, StringComparison.Ordinal))
            summaryMarkdown = summaryMarkdown[SummaryHeader.Length..].Trim();

        return (summaryMarkdown, actionItems, suggestedTitle);
    }

    private static string? ExtractSuggestedTitle(string[] lines)
    {
        var start = Array.FindIndex(lines, static line => line.Trim() == TitleHeader);
        if (start < 0)
            return null;

        var parts = new List<string>();
        for (var i = start + 1; i < lines.Length; i++)
        {
            var trimmed = lines[i].Trim();
            if (trimmed.StartsWith("## ", StringComparison.Ordinal))
                break;
            if (trimmed.Length > 0)
                parts.Add(trimmed);
        }

        return parts.Count == 0 ? null : string.Join(' ', parts);
    }

    private static string[] StripTitleBlock(string[] lines)
    {
        var start = Array.FindIndex(lines, static line => line.Trim() == TitleHeader);
        if (start < 0)
            return lines;

        var end = lines.Length;
        for (var i = start + 1; i < lines.Length; i++)
        {
            if (lines[i].Trim().StartsWith("## ", StringComparison.Ordinal))
            {
                end = i;
                break;
            }
        }

        var kept = new string[lines.Length - (end - start)];
        Array.Copy(lines, 0, kept, 0, start);
        Array.Copy(lines, end, kept, start, lines.Length - end);
        return kept;
    }
}
