namespace MeetingLive.Core.Services;

/// <summary>Stable color keys for Library folders. UI maps these to theme brushes.</summary>
public static class FolderAccent
{
    public static readonly string[] Keys = ["blue", "teal", "green", "amber", "orange", "red", "purple"];

    public static string ResolveKey(string? stored, Guid folderId)
    {
        if (stored is not null)
        {
            foreach (var key in Keys)
            {
                if (string.Equals(key, stored, StringComparison.OrdinalIgnoreCase))
                    return key;
            }
        }

        var index = Math.Abs(HashCode.Combine(folderId)) % Keys.Length;
        return Keys[index];
    }

    public static string NextKey(IEnumerable<string?> existing)
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in existing)
        {
            if (key is not null)
                used.Add(key);
        }

        foreach (var key in Keys)
        {
            if (!used.Contains(key))
                return key;
        }

        return Keys[used.Count % Keys.Length];
    }

    public static string BrushResourceName(string key) => key switch
    {
        "blue" => "FolderAccentBlueBrush",
        "teal" => "FolderAccentTealBrush",
        "green" => "FolderAccentGreenBrush",
        "amber" => "FolderAccentAmberBrush",
        "orange" => "FolderAccentOrangeBrush",
        "red" => "FolderAccentRedBrush",
        "purple" => "FolderAccentPurpleBrush",
        _ => "FolderAccentNeutralBrush",
    };
}
