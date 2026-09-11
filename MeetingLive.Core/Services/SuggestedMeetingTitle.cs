using System.Text.RegularExpressions;

namespace MeetingLive.Core.Services;

/// <summary>
/// Normalizes a model-suggested meeting title. <see cref="Resolve"/> applies it only
/// when the current title is still the auto-generated placeholder (<c>Meeting {date}</c>).
/// <see cref="FromModelResponse"/> is the always-apply parse used by explicit regenerate.
/// </summary>
public static partial class SuggestedMeetingTitle
{
    private const int MaxLength = 80;
    private const string TitleHeader = "## Title";

    [GeneratedRegex(@"^Meeting\s+\d", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex PlaceholderPattern();

    /// <summary>
    /// Parses title-only model stdout. If the model still wraps a <c>## Title</c> block,
    /// the body until the next <c>## </c> heading is used; otherwise the raw text is
    /// normalized. Heading-only responses return null (not <c>Title</c>).
    /// </summary>
    public static string? FromModelResponse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var lines = raw.Replace("\r\n", "\n").Split('\n');
        var start = Array.FindIndex(lines, static line => line.Trim() == TitleHeader);
        if (start < 0)
            return Normalize(raw);

        var parts = new List<string>();
        for (var i = start + 1; i < lines.Length; i++)
        {
            var trimmed = lines[i].Trim();
            if (trimmed.StartsWith("## ", StringComparison.Ordinal))
                break;
            if (trimmed.Length > 0)
                parts.Add(trimmed);
        }

        return parts.Count == 0 ? null : Normalize(string.Join(' ', parts));
    }

    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        string? firstLine = null;
        foreach (var line in raw.Replace("\r\n", "\n").Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.Length == 0)
                continue;

            firstLine = trimmed;
            break;
        }

        if (firstLine is null)
            return null;

        var value = firstLine.TrimStart('#').Trim();
        value = StripWrappingQuotes(value).Trim();
        value = value.TrimEnd('.').Trim();

        if (value.Length > MaxLength)
            value = value[..MaxLength].Trim();

        return value.Length == 0 ? null : value;
    }

    public static bool LooksLikePlaceholder(string? currentTitle) =>
        string.IsNullOrWhiteSpace(currentTitle) || PlaceholderPattern().IsMatch(currentTitle.Trim());

    public static string Resolve(string currentTitle, string? suggested)
    {
        var normalized = Normalize(suggested);
        if (normalized is null)
            return currentTitle;

        return LooksLikePlaceholder(currentTitle) ? normalized : currentTitle;
    }

    private static string StripWrappingQuotes(string value)
    {
        if (value.Length < 2)
            return value;

        var start = value[0];
        var end = value[^1];
        var wrapped =
            (start == '"' && end == '"') ||
            (start == '\u201c' && end == '\u201d');

        return wrapped ? value[1..^1] : value;
    }
}
