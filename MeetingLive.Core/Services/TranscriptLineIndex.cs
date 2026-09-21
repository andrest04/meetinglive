namespace MeetingLive.Core.Services;

/// <summary>One non-empty transcript line, tagged so TypeSafe can point at it.</summary>
public sealed record TranscriptLine(string Id, int Index, string Text);

/// <summary>
/// Splits a transcript into tagged lines for TypeSafe Choice options (max 255).
/// </summary>
public static class TranscriptLineIndex
{
    public const int MaxChoiceOptions = 255;

    public static string LineId(int index) => $"L{index:000}";

    public static IReadOnlyList<TranscriptLine> Parse(string? transcript)
    {
        if (string.IsNullOrWhiteSpace(transcript))
            return [];

        var lines = new List<TranscriptLine>();
        var parts = transcript.Split(["\r\n", "\n"], StringSplitOptions.None);
        foreach (var part in parts)
        {
            var text = part.Trim();
            if (text.Length == 0)
                continue;

            var index = lines.Count;
            lines.Add(new TranscriptLine(LineId(index), index, text));
        }

        return lines;
    }

    public static string BuildTaggedDocument(IReadOnlyList<TranscriptLine> lines)
    {
        ArgumentNullException.ThrowIfNull(lines);
        if (lines.Count == 0)
            return string.Empty;

        return string.Join('\n', lines.Select(FormatTaggedLine));
    }

    internal static string FormatTaggedLine(TranscriptLine line) => $"{line.Id}| {line.Text}";

    /// <summary>Drops trailing complete lines until the tagged document fits <paramref name="maxChars"/>.</summary>
    internal static IReadOnlyList<TranscriptLine> TruncateToCompleteLines(
        IReadOnlyList<TranscriptLine> lines,
        int maxChars)
    {
        ArgumentNullException.ThrowIfNull(lines);
        if (lines.Count == 0 || maxChars <= 0)
            return [];

        var tagged = BuildTaggedDocument(lines);
        if (tagged.Length <= maxChars)
            return lines;

        var kept = new List<TranscriptLine>();
        var length = 0;
        foreach (var line in lines)
        {
            var piece = FormatTaggedLine(line);
            var add = piece.Length + (kept.Count > 0 ? 1 : 0);
            if (length + add > maxChars)
                break;

            kept.Add(line);
            length += add;
        }

        if (kept.Count == 0)
            kept.Add(lines[0]);

        return kept;
    }
}
