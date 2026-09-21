using System.Globalization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Reads committed transcript lines in the <see cref="TranscriptStampFormatter"/> shape.
/// </summary>
internal static class CommittedTranscriptLine
{
    public static string[] Split(string? transcript)
    {
        if (string.IsNullOrEmpty(transcript))
            return [];

        return transcript.Split(["\r\n", "\n", "\r"], StringSplitOptions.None);
    }

    public static bool IsHeader(string line)
    {
        if (string.IsNullOrEmpty(line))
            return false;

        var trimmed = line.TrimStart();
        return trimmed.StartsWith("Recorded ", StringComparison.Ordinal)
            || trimmed.StartsWith("Ended ", StringComparison.Ordinal);
    }

    public static bool TryParseEnd(string line, out TimeSpan end)
    {
        end = default;
        if (!TryReadStamp(line, out var stamp, out _))
            return false;

        return TryParseRange(stamp, out _, out end);
    }

    public static string ExtractBody(string line)
    {
        if (string.IsNullOrEmpty(line))
            return string.Empty;

        if (!TryReadStamp(line, out var stamp, out var close))
            return line.Trim();

        if (!TryParseRange(stamp, out _, out _))
            return line.Trim();

        var rest = StripSpeakerTag(line[(close + 1)..]);
        return rest.Trim();
    }

    private static bool TryReadStamp(string line, out ReadOnlySpan<char> stamp, out int close)
    {
        stamp = default;
        close = -1;
        if (string.IsNullOrEmpty(line) || line[0] != '[')
            return false;

        close = line.IndexOf(']');
        if (close <= 1)
            return false;

        stamp = line.AsSpan(1, close - 1);
        return true;
    }

    private static string StripSpeakerTag(string afterStamp)
    {
        const string prefix = " [ Speaker-";
        if (!afterStamp.StartsWith(prefix, StringComparison.Ordinal))
            return afterStamp;

        var tagClose = afterStamp.IndexOf(']', prefix.Length);
        if (tagClose < prefix.Length + 2 || afterStamp[tagClose - 1] != ' ')
            return afterStamp;

        var digits = afterStamp.AsSpan(prefix.Length, tagClose - prefix.Length - 1);
        if (digits.IsEmpty || !AllDigits(digits))
            return afterStamp;

        return afterStamp[(tagClose + 1)..];
    }

    private static bool AllDigits(ReadOnlySpan<char> text)
    {
        foreach (var character in text)
        {
            if (character is < '0' or > '9')
                return false;
        }

        return true;
    }

    private static bool TryParseRange(ReadOnlySpan<char> stamp, out TimeSpan start, out TimeSpan end)
    {
        start = default;
        end = default;
        var dash = stamp.IndexOf('-');
        if (dash <= 0 || dash >= stamp.Length - 1)
            return false;

        return TryParseElapsed(stamp[..dash], out start)
            && TryParseElapsed(stamp[(dash + 1)..], out end);
    }

    private static bool TryParseElapsed(ReadOnlySpan<char> text, out TimeSpan time)
    {
        time = default;
        var colon = text.IndexOf(':');
        if (colon < 2)
            return false;

        var dot = text.IndexOf('.');
        if (dot != colon + 3 || text.Length != dot + 3)
            return false;

        if (!int.TryParse(text[..colon], NumberStyles.None, CultureInfo.InvariantCulture, out var minutes))
            return false;
        if (!int.TryParse(text.Slice(colon + 1, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
            || seconds > 59)
            return false;
        if (!int.TryParse(text.Slice(dot + 1, 2), NumberStyles.None, CultureInfo.InvariantCulture, out var hundredths))
            return false;

        try
        {
            time = TimeSpan.FromMinutes(minutes)
                + TimeSpan.FromSeconds(seconds)
                + TimeSpan.FromMilliseconds(hundredths * 10);
            return true;
        }
        catch (OverflowException)
        {
            time = default;
            return false;
        }
    }
}
