namespace MeetingLive.Core.Services;

/// <summary>
/// Pure heuristics: is this process/title a live Zoom, Teams, or Meet call?
/// Window enumeration stays in the app; this type is unit-tested.
/// </summary>
public static class MeetingCallDetector
{
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

        if (process is "chrome" or "msedge" or "firefox" or "brave")
        {
            return ContainsAny(
                title,
                "Google Meet",
                "Meet -",
                "Meet –",
                "Zoom",
                "Microsoft Teams");
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
