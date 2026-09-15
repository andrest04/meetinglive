using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Maps Library folders and meeting titles onto real directories under
/// <see cref="AppPaths.UserDataDirectory"/>. Inbox is a reserved folder name.
/// Markdown and WAV for one meeting share the same stem and move together.
/// </summary>
public static class MeetingLibraryLayout
{
    public const string InboxFolderName = "Inbox";

    public static string InboxDirectory(string root) => Path.Combine(root, InboxFolderName);

    public static string DirectoryFor(string root, IReadOnlyList<FolderRecord> folders, Guid? folderId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(root);
        ArgumentNullException.ThrowIfNull(folders);

        if (folderId is null)
            return InboxDirectory(root);

        var byId = folders.ToDictionary(folder => folder.Id);
        var segments = new List<string>();
        var current = folderId;
        var guard = 0;
        while (current is { } id)
        {
            if (++guard > 64 || !byId.TryGetValue(id, out var folder))
                break;

            segments.Add(SanitizeName(folder.Name));
            current = folder.ParentId;
        }

        if (segments.Count == 0)
            return InboxDirectory(root);

        segments.Reverse();
        return Path.Combine([root, .. segments]);
    }

    public static string FileStem(DateTimeOffset recordedAt, string? title)
    {
        var date = $"{recordedAt.Year:D4}-{recordedAt.Month:D2}-{recordedAt.Day:D2}";
        return $"{date} {SanitizeName(title)}";
    }

    public static string MarkdownPath(string directory, string stem) =>
        Path.Combine(directory, stem + ".md");

    public static string AudioPath(string directory, string stem) =>
        Path.Combine(directory, stem + ".wav");

    public static string AllocateFileStem(
        string directory,
        string desiredStem,
        Guid meetingId,
        Func<string, Guid?> idFromMarkdownPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        ArgumentException.ThrowIfNullOrWhiteSpace(desiredStem);
        ArgumentNullException.ThrowIfNull(idFromMarkdownPath);

        Directory.CreateDirectory(directory);
        for (var n = 1; ; n++)
        {
            var stem = n == 1 ? desiredStem : $"{desiredStem} {n}";
            var markdownPath = MarkdownPath(directory, stem);
            if (File.Exists(markdownPath) && idFromMarkdownPath(markdownPath) == meetingId)
                return stem;

            if (!File.Exists(markdownPath) && !File.Exists(AudioPath(directory, stem)))
                return stem;
        }
    }

    public static string SanitizeName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return "Meeting";

        var invalid = Path.GetInvalidFileNameChars();
        var chars = name.Trim().Select(ch => Array.IndexOf(invalid, ch) >= 0 ? ' ' : ch).ToArray();
        var cleaned = new string(chars);
        while (cleaned.Contains("  ", StringComparison.Ordinal))
            cleaned = cleaned.Replace("  ", " ", StringComparison.Ordinal);

        cleaned = cleaned.Trim().TrimEnd('.');
        if (cleaned.Length > 80)
            cleaned = cleaned[..80].Trim().TrimEnd('.');

        if (string.IsNullOrWhiteSpace(cleaned))
            return "Meeting";

        if (cleaned.Equals(InboxFolderName, StringComparison.OrdinalIgnoreCase))
            return "Inbox folder";

        return cleaned;
    }

    public static bool PathsEqual(string left, string right) =>
        string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);

    public static void MoveFileIfNeeded(string? source, string destination)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(destination);
        if (string.IsNullOrWhiteSpace(source) || !File.Exists(source))
            return;

        if (PathsEqual(source, destination))
            return;

        var directory = Path.GetDirectoryName(destination);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        if (File.Exists(destination))
            File.Delete(destination);

        File.Move(source, destination);
    }

    internal static string ReplaceAudioFilePathLine(string markdown, string audioPath)
    {
        const string prefix = "audioFilePath: ";
        var newline = markdown.Contains("\r\n", StringComparison.Ordinal) ? "\r\n" : "\n";
        var lines = markdown.Replace("\r\n", "\n").Split('\n');
        var found = false;
        for (var i = 0; i < lines.Length; i++)
        {
            if (!lines[i].StartsWith(prefix, StringComparison.Ordinal))
                continue;

            lines[i] = prefix + audioPath;
            found = true;
            break;
        }

        return found ? string.Join(newline, lines) : markdown;
    }

    internal static void RewriteSiblingAudioPaths(string directory)
    {
        if (!Directory.Exists(directory))
            return;

        foreach (var markdownPath in Directory.EnumerateFiles(directory, "*.md", SearchOption.AllDirectories))
        {
            var markdown = File.ReadAllText(markdownPath);
            var updated = ReplaceAudioFilePathLine(markdown, Path.ChangeExtension(markdownPath, ".wav"));
            if (updated != markdown)
                File.WriteAllText(markdownPath, updated);
        }
    }
}
