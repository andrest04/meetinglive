using System.Text;

namespace MeetingLive.Core.Services;

/// <summary>
/// Turns meeting summary/transcript Markdown into a single-line list snippet.
/// Skips ATX heading lines when there is body text (section titles read as noise in a preview),
/// strips emphasis and backticks, collapses whitespace, and truncates to <see cref="MaxLength"/>.
/// The transcript fallback drops the <c>Recorded</c>/<c>Ended</c> headers, elapsed stamps, and speaker tags.
/// </summary>
public static class MeetingSnippet
{
    public const int MaxLength = 140;

    public static string From(string? summary, string? transcript)
    {
        if (!string.IsNullOrWhiteSpace(summary))
            return FromMarkdown(summary);

        return FromMarkdown(TranscriptBody(transcript));
    }

    public static string FromMarkdown(string? markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown))
            return string.Empty;

        var normalized = markdown.Replace("\r\n", "\n").Replace('\r', '\n');
        var body = new StringBuilder(normalized.Length);
        var headings = new StringBuilder();
        foreach (var rawLine in normalized.Split('\n'))
        {
            var isHeading = IsHeading(rawLine.Trim());
            var line = StripMarkers(rawLine);
            if (line.Length == 0)
                continue;

            var target = isHeading ? headings : body;
            if (target.Length > 0)
                target.Append(' ');
            target.Append(line);
        }

        var collapsed = CollapseWhitespace(body.Length > 0 ? body.ToString() : headings.ToString());
        if (collapsed.Length <= MaxLength)
            return collapsed;

        return collapsed[..MaxLength] + "…";
    }

    private static string TranscriptBody(string? transcript)
    {
        var builder = new StringBuilder();
        foreach (var line in CommittedTranscriptLine.Split(transcript))
        {
            if (CommittedTranscriptLine.IsHeader(line))
                continue;

            var text = CommittedTranscriptLine.ExtractBody(line);
            if (text.Length == 0)
                continue;

            if (builder.Length > 0)
                builder.Append('\n');
            builder.Append(text);
        }

        return builder.ToString();
    }

    private static int HeadingLevel(string trimmed)
    {
        var hashCount = 0;
        while (hashCount < trimmed.Length && hashCount < 6 && trimmed[hashCount] == '#')
            hashCount++;
        return hashCount > 0 && (hashCount == trimmed.Length || char.IsWhiteSpace(trimmed[hashCount])) ? hashCount : 0;
    }

    private static bool IsHeading(string trimmed) => HeadingLevel(trimmed) > 0;

    private static string StripMarkers(string line)
    {
        var trimmed = line.Trim();
        var hashCount = HeadingLevel(trimmed);
        if (hashCount > 0)
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
