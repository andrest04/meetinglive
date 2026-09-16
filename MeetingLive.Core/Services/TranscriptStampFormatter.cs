using System.Globalization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Shared transcript stamp format used by live Nemo preview and offline Nemotron.
/// Optional headers <c>Recorded yyyy-MM-dd HH:mm</c> and <c>Ended yyyy-MM-dd HH:mm</c>; lines
/// <c>[mm:ss.ff-mm:ss.ff] [ Speaker-N ] text</c>, or <c>[mm:ss.ff-mm:ss.ff] text</c> when speakerTag is 0.
/// </summary>
public static class TranscriptStampFormatter
{
    public static string FormatHeader(DateTimeOffset recordedAt)
    {
        var stamp = recordedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        return $"Recorded {stamp}";
    }

    public static string FormatEnded(DateTimeOffset endedAt)
    {
        var stamp = endedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        return $"Ended {stamp}";
    }

    /// <summary>
    /// Ensures a transcript has an <c>Ended</c> header after <c>Recorded</c>.
    /// No-op when the transcript is empty or either timestamp is default.
    /// Idempotent: a second call replaces the existing Ended line instead of duplicating it.
    /// </summary>
    public static string EnsureEndedHeader(string transcript, DateTimeOffset recordedAt, DateTimeOffset endedAt)
    {
        if (string.IsNullOrEmpty(transcript) || recordedAt == default || endedAt == default)
            return transcript;

        var newline = transcript.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        var recorded = FormatHeader(recordedAt);
        var ended = FormatEnded(endedAt);
        var lines = transcript.Split(["\r\n", "\n"], StringSplitOptions.None);

        if (lines[0].StartsWith("Recorded ", StringComparison.Ordinal))
        {
            if (lines.Length > 1 && lines[1].StartsWith("Ended ", StringComparison.Ordinal))
            {
                lines[1] = ended;
                return string.Join(newline, lines);
            }

            var inserted = new string[lines.Length + 1];
            inserted[0] = lines[0];
            inserted[1] = ended;
            Array.Copy(lines, 1, inserted, 2, lines.Length - 1);
            return string.Join(newline, inserted);
        }

        return recorded + newline + ended + newline + transcript;
    }

    public static string FormatLine(TimeSpan start, TimeSpan end, string text, int speakerTag = 0)
    {
        if (start < TimeSpan.Zero)
            start = TimeSpan.Zero;
        if (end < start)
            end = start;

        var range = $"[{FormatElapsed(start)}-{FormatElapsed(end)}]";
        if (speakerTag > 0)
            return $"{range} [ Speaker-{speakerTag} ] {text}";

        return $"{range} {text}";
    }

    private static string FormatElapsed(TimeSpan time)
    {
        if (time < TimeSpan.Zero)
            time = TimeSpan.Zero;

        var totalMinutes = (int)time.TotalMinutes;
        var seconds = time.Seconds;
        var hundredths = time.Milliseconds / 10;
        return string.Create(CultureInfo.InvariantCulture, $"{totalMinutes:00}:{seconds:00}.{hundredths:00}");
    }
}
