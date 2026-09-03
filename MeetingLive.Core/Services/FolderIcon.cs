namespace MeetingLive.Core.Services;

/// <summary>Stable icon keys for Library folders. UI maps these to Segoe Fluent glyphs.</summary>
public static class FolderIcon
{
    public const string DefaultKey = "folder";

    public static readonly string[] Keys =
    [
        "folder",
        "briefcase",
        "people",
        "home",
        "star",
        "heart",
        "flag",
        "globe",
        "lock",
        "calendar",
        "mail",
        "chat",
        "video",
        "book",
        "pin",
        "tag",
        "education",
        "toolbox",
    ];

    public static string ResolveKey(string? stored)
    {
        if (stored is not null)
        {
            foreach (var key in Keys)
            {
                if (string.Equals(key, stored, StringComparison.OrdinalIgnoreCase))
                    return key;
            }
        }

        return DefaultKey;
    }

    public static string Glyph(string? stored) => ResolveKey(stored) switch
    {
        "briefcase" => "\uE821",
        "people" => "\uE77B",
        "home" => "\uE80F",
        "star" => "\uE734",
        "heart" => "\uEB51",
        "flag" => "\uE7C1",
        "globe" => "\uE774",
        "lock" => "\uE72E",
        "calendar" => "\uE787",
        "mail" => "\uE715",
        "chat" => "\uE8F2",
        "video" => "\uE714",
        "book" => "\uE8F1",
        "pin" => "\uE718",
        "tag" => "\uE8EC",
        "education" => "\uE7BE",
        "toolbox" => "\uEC7A",
        _ => "\uE8B7",
    };

    public static string ResolveGlyph(string? stored) => Glyph(stored);
}
