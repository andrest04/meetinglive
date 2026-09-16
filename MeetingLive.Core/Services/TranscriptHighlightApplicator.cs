using System.Globalization;
using System.Text.RegularExpressions;

namespace MeetingLive.Core.Services;

/// <summary>
/// Stars timestamped transcript lines at elapsed times the user marked live (Otter-style
/// highlights). Idempotent: a line already prefixed with <see cref="MarkerPrefix"/> is left alone.
/// </summary>
public static class TranscriptHighlightApplicator
{
    public const string MarkerPrefix = "* ";

    private static readonly Regex LineRange = new(
        @"^\[(\d+):(\d{2}\.\d{2})-(\d+):(\d{2}\.\d{2})\]",
        RegexOptions.Compiled);

    public static string FormatMarkLine(TimeSpan elapsed) =>
        MarkerPrefix + TranscriptStampFormatter.FormatElapsed(elapsed);

    public static string Apply(string? transcript, IReadOnlyList<TimeSpan> highlights)
    {
        var marks = highlights
            .Select(time => time < TimeSpan.Zero ? TimeSpan.Zero : time)
            .Distinct()
            .OrderBy(time => time)
            .ToArray();

        if (marks.Length == 0)
            return transcript ?? string.Empty;

        if (string.IsNullOrEmpty(transcript))
            return string.Join('\n', marks.Select(FormatMarkLine));

        var newline = transcript.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        var lines = transcript.Split(["\r\n", "\n"], StringSplitOptions.None);
        var indexed = new List<(int Index, TimeSpan Start, TimeSpan End)>();

        for (var i = 0; i < lines.Length; i++)
        {
            var body = StripMarker(lines[i]);
            var match = LineRange.Match(body);
            if (!match.Success)
                continue;

            indexed.Add((
                i,
                ParseElapsed(match.Groups[1].Value, match.Groups[2].Value),
                ParseElapsed(match.Groups[3].Value, match.Groups[4].Value)));
        }

        if (indexed.Count == 0)
        {
            var extra = marks.Select(FormatMarkLine);
            return string.Join(newline, lines.Concat(extra));
        }

        var starred = new HashSet<int>();
        foreach (var mark in marks)
        {
            var lineIndex = FindLineIndex(indexed, mark);
            if (starred.Add(lineIndex) && !lines[lineIndex].StartsWith(MarkerPrefix, StringComparison.Ordinal))
                lines[lineIndex] = MarkerPrefix + lines[lineIndex];
        }

        return string.Join(newline, lines);
    }

    private static string StripMarker(string line) =>
        line.StartsWith(MarkerPrefix, StringComparison.Ordinal) ? line[MarkerPrefix.Length..] : line;

    private static int FindLineIndex(
        List<(int Index, TimeSpan Start, TimeSpan End)> indexed,
        TimeSpan mark)
    {
        foreach (var candidate in indexed)
        {
            if (mark >= candidate.Start && mark <= candidate.End)
                return candidate.Index;
        }

        var previous = indexed[0];
        foreach (var candidate in indexed)
        {
            if (candidate.Start > mark)
                break;
            previous = candidate;
        }

        return previous.Index;
    }

    private static TimeSpan ParseElapsed(string minutes, string seconds)
    {
        var minuteValue = int.Parse(minutes, CultureInfo.InvariantCulture);
        var secondValue = double.Parse(seconds, CultureInfo.InvariantCulture);
        return TimeSpan.FromMinutes(minuteValue) + TimeSpan.FromSeconds(secondValue);
    }
}
