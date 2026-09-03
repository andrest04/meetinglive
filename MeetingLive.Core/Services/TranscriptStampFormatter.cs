using System.Globalization;

namespace MeetingLive.Core.Services;

/// <summary>
/// Shared transcript stamp format used by live Nemo preview and offline Nemotron.
/// Optional header <c>Recorded yyyy-MM-dd HH:mm</c>; lines
/// <c>[hh:mm:ss | HH:mm] text</c> or <c>[hh:mm:ss] text</c> when <paramref name="recordedAt"/> is default.
/// </summary>
public static class TranscriptStampFormatter
{
    public static string FormatHeader(DateTimeOffset recordedAt)
    {
        var stamp = recordedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        return $"Recorded {stamp}";
    }

    public static string FormatLine(TimeSpan start, string text, DateTimeOffset recordedAt, TimeSpan clockSkew = default)
    {
        var elapsed = FormatElapsed(start);
        if (recordedAt == default)
            return $"[{elapsed}] {text}";

        var clock = (recordedAt.ToLocalTime() + start + clockSkew).ToString("HH:mm", CultureInfo.InvariantCulture);
        return $"[{elapsed} | {clock}] {text}";
    }

    private static string FormatElapsed(TimeSpan time)
    {
        if (time < TimeSpan.Zero)
            time = TimeSpan.Zero;
        return time.ToString(@"hh\:mm\:ss");
    }
}
