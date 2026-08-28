using System.Text;
using System.Text.RegularExpressions;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Converts between the body of a "## Action Items" Markdown section and
/// <see cref="ActionItem"/> instances. Shared by <see cref="MarkdownMeetingRepository"/>
/// and the summary providers, which are asked to emit the same checkbox format.
/// </summary>
public static class ActionItemParser
{
    private static readonly Regex ItemLine = new(@"^\s*-\s\[( |x|X)\]\s+(.*)$", RegexOptions.Compiled);

    /// <summary>Parses every <c>- [ ] text</c> / <c>- [x] text</c> line found in
    /// <paramref name="sectionBody"/>. Lines that don't match the checkbox pattern
    /// are ignored rather than throwing, so surrounding prose doesn't break parsing.</summary>
    public static IReadOnlyList<ActionItem> Parse(string sectionBody)
    {
        if (string.IsNullOrWhiteSpace(sectionBody))
            return [];

        var items = new List<ActionItem>();
        foreach (var rawLine in sectionBody.Replace("\r\n", "\n").Split('\n'))
        {
            var match = ItemLine.Match(rawLine);
            if (!match.Success)
                continue;

            items.Add(new ActionItem
            {
                Text = match.Groups[2].Value.Trim(),
                IsDone = match.Groups[1].Value is "x" or "X",
            });
        }

        return items;
    }

    /// <summary>Renders <paramref name="items"/> back as Markdown checkbox lines,
    /// one per line, terminated with a trailing newline.</summary>
    public static string Render(IReadOnlyList<ActionItem> items)
    {
        if (items.Count == 0)
            return string.Empty;

        var sb = new StringBuilder();
        foreach (var item in items)
            sb.Append("- [").Append(item.IsDone ? 'x' : ' ').Append("] ").Append(item.Text).Append('\n');

        return sb.ToString();
    }
}
