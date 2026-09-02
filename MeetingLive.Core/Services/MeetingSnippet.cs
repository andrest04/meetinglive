using System.Text;

namespace MeetingLive.Core.Services;

/// <summary>
/// Turns meeting summary/transcript Markdown into a single-line list snippet.
/// Strips common markers (ATX headings, emphasis, backticks), collapses
/// whitespace, and truncates to <see cref="MaxLength"/> characters.
/// </summary>
public static class MeetingSnippet
{
    public const int MaxLength = 140;

    public static string From(string? summary, string? transcript)
    {
        var source = !string.IsNullOrWhiteSpace(summary) ? summary : transcript;
        return FromMarkdown(source);
    }

    public static string FromMarkdown(string? markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
            return string.Empty;

        var normalized = markdown.Replace("\r\n", "\n").Replace('\r', '\n');
        var builder = new StringBuilder(normalized.Length);
        foreach (var rawLine in normalized.Split('\n'))
        {
            var line = StripMarkers(rawLine);
            if (line.Length == 0)
                continue;

            if (builder.Length > 0)
                builder.Append(' ');
            builder.Append(line);
        }

        var collapsed = CollapseWhitespace(builder.ToString());
        if (collapsed.Length <= MaxLength)
            return collapsed;

        return collapsed[..MaxLength] + "…";
    }

    private static string StripMarkers(string line)
    {
        var trimmed = line.Trim();
        var hashCount = 0;
        while (hashCount < trimmed.Length && hashCount < 6 && trimmed[hashCount] == '#')
            hashCount++;
        if (hashCount > 0 && (hashCount == trimmed.Length || char.IsWhiteSpace(trimmed[hashCount])))
            trimmed = trimmed[hashCount..].TrimStart();

        return trimmed
            .Replace("```", string.Empty)
            .Replace("**", string.Empty)
            .Replace("__", string.Empty)
            .Replace("`", string.Empty)
            .Replace("*", string.Empty)
            .Replace("_", string.Empty)
            .Trim();
    }

    private static string CollapseWhitespace(string text)
    {
        var builder = new StringBuilder(text.Length);
        var previousWasSpace = false;
        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch))
            {
                if (previousWasSpace)
                    continue;
                builder.Append(' ');
                previousWasSpace = true;
            }
            else
            {
                builder.Append(ch);
                previousWasSpace = false;
            }
        }

        return builder.ToString().Trim();
    }
}
