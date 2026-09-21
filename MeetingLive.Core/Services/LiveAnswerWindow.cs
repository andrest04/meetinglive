namespace MeetingLive.Core.Services;

/// <summary>
/// Selects the recent committed transcript used as context for a live answer.
/// </summary>
public static class LiveAnswerWindow
{
    public static readonly TimeSpan Default = TimeSpan.FromSeconds(90);

    private const int UntimestampedFallbackCharacters = 2500;

    public static string TakeRecent(string? committedTranscript, TimeSpan window)
    {
        if (string.IsNullOrEmpty(committedTranscript))
            return string.Empty;

        var lines = CommittedTranscriptLine.Split(committedTranscript);
        var parsed = new (bool HasEnd, TimeSpan End, bool IsHeader)[lines.Length];
        TimeSpan? latest = null;

        for (var i = 0; i < lines.Length; i++)
        {
            var hasEnd = CommittedTranscriptLine.TryParseEnd(lines[i], out var end);
            var isHeader = CommittedTranscriptLine.IsHeader(lines[i]);
            parsed[i] = (hasEnd, end, isHeader);
            if (hasEnd && (latest is null || end > latest.Value))
                latest = end;
        }

        if (latest is null)
            return Tail(committedTranscript, UntimestampedFallbackCharacters);

        var cutoff = SubtractWindow(latest.Value, window);
        var firstInSpan = -1;
        var lastInSpan = -1;
        for (var i = 0; i < parsed.Length; i++)
        {
            if (!IsInSpan(parsed[i], cutoff, latest.Value))
                continue;

            if (firstInSpan < 0)
                firstInSpan = i;
            lastInSpan = i;
        }

        if (firstInSpan < 0)
            return string.Empty;

        var kept = new List<string>();
        for (var i = 0; i < lines.Length; i++)
        {
            if (parsed[i].IsHeader)
                continue;

            if (parsed[i].HasEnd)
            {
                if (IsInSpan(parsed[i], cutoff, latest.Value))
                    kept.Add(lines[i]);
                continue;
            }

            if (i >= firstInSpan && i <= lastInSpan)
                kept.Add(lines[i]);
        }

        var newline = committedTranscript.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        return string.Join(newline, kept);
    }

    private static bool IsInSpan(
        (bool HasEnd, TimeSpan End, bool IsHeader) line,
        TimeSpan cutoff,
        TimeSpan latest)
    {
        return line.HasEnd && line.End >= cutoff && line.End <= latest;
    }

    private static TimeSpan SubtractWindow(TimeSpan latest, TimeSpan window)
    {
        try
        {
            return latest - window;
        }
        catch (OverflowException)
        {
            return window < TimeSpan.Zero ? TimeSpan.MaxValue : TimeSpan.MinValue;
        }
    }

    private static string Tail(string transcript, int count)
    {
        if (transcript.Length <= count)
            return transcript;

        return transcript[^count..];
    }
}
