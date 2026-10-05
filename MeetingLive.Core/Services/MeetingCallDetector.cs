using System.Text.RegularExpressions;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pure heuristics: is this process/title a live Zoom, Teams, or Meet call?
/// Window enumeration stays in the app; this type is unit-tested.
/// </summary>
public static class MeetingCallDetector
{
    private static readonly Regex MeetCodePattern = new(
        @"\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static bool IsMeeting(string? processName, string? windowTitle)
    {
        var process = (processName ?? string.Empty).Trim().ToLowerInvariant();
        var title = windowTitle ?? string.Empty;
        if (process.Length == 0)
            return false;

        if (process is "cpthost")
            return true;

        if (process is "zoom")
            return ContainsAny(title, "Zoom Meeting", "Zoom Webinar");

        if (process is "teams" or "ms-teams")
            return ContainsAny(title, "Meeting", "Call");

        if (process is "chrome" or "msedge" or "firefox" or "brave" or "opera" or "vivaldi")
        {
            // Only an in-call Meet tab counts: the landing page has no meeting code in its title.
            return MeetCodePattern.IsMatch(title) && title.Contains("Meet", StringComparison.OrdinalIgnoreCase);
        }

        return false;
    }

    private static bool ContainsAny(string title, params string[] needles)
    {
        foreach (var needle in needles)
        {
            if (title.Contains(needle, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }
}
