namespace MeetingLive.Core.Services;

/// <summary>
/// One-time move of meeting files from %LOCALAPPDATA%\MeetingLive into
/// Documents\MeetingLive. App configuration stays in LocalAppData.
/// A failed move is left to throw so the user sees it instead of a split library.
/// </summary>
public sealed class UserDataLocationMigrationService
{
    private readonly string _legacyMeetingsDirectory;
    private readonly string _legacyRecordingsDirectory;
    private readonly string _legacyFoldersFilePath;
    private readonly string _meetingsDirectory;
    private readonly string _recordingsDirectory;
    private readonly string _foldersFilePath;

    public UserDataLocationMigrationService()
        : this(
            AppPaths.LegacyMeetingsDirectory,
            AppPaths.LegacyRecordingsDirectory,
            AppPaths.LegacyFoldersFilePath,
            AppPaths.MeetingsDirectory,
            AppPaths.RecordingsDirectory,
            AppPaths.FoldersFilePath)
    {
    }

    internal UserDataLocationMigrationService(
        string legacyMeetingsDirectory,
        string legacyRecordingsDirectory,
        string legacyFoldersFilePath,
        string meetingsDirectory,
        string recordingsDirectory,
        string foldersFilePath)
    {
        _legacyMeetingsDirectory = legacyMeetingsDirectory;
        _legacyRecordingsDirectory = legacyRecordingsDirectory;
        _legacyFoldersFilePath = legacyFoldersFilePath;
        _meetingsDirectory = meetingsDirectory;
        _recordingsDirectory = recordingsDirectory;
        _foldersFilePath = foldersFilePath;
    }

    public void MigrateIfNeeded()
    {
        if (PathsEqual(_legacyMeetingsDirectory, _meetingsDirectory) &&
            PathsEqual(_legacyRecordingsDirectory, _recordingsDirectory) &&
            PathsEqual(_legacyFoldersFilePath, _foldersFilePath))
        {
            return;
        }

        Directory.CreateDirectory(_meetingsDirectory);
        Directory.CreateDirectory(_recordingsDirectory);

        MoveDirectoryContents(_legacyMeetingsDirectory, _meetingsDirectory);
        MoveDirectoryContents(_legacyRecordingsDirectory, _recordingsDirectory);
        MoveFileIfNeeded(_legacyFoldersFilePath, _foldersFilePath);
        RewriteAudioPaths();
        TryDeleteEmptyDirectory(_legacyMeetingsDirectory);
        TryDeleteEmptyDirectory(_legacyRecordingsDirectory);
    }

    private void RewriteAudioPaths()
    {
        if (!Directory.Exists(_meetingsDirectory))
            return;

        foreach (var path in Directory.EnumerateFiles(_meetingsDirectory, "*.md"))
        {
            var markdown = File.ReadAllText(path);
            var updated = RewriteAudioFilePathLine(markdown, _legacyRecordingsDirectory, _recordingsDirectory);
            if (updated != markdown)
                File.WriteAllText(path, updated);
        }
    }

    private static void MoveDirectoryContents(string source, string destination)
    {
        if (!Directory.Exists(source) || PathsEqual(source, destination))
            return;

        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(source))
        {
            var destFile = Path.Combine(destination, Path.GetFileName(file));
            if (!File.Exists(destFile))
                File.Move(file, destFile);
        }
    }

    private static void MoveFileIfNeeded(string source, string destination)
    {
        if (!File.Exists(source) || PathsEqual(source, destination))
            return;

        var directory = Path.GetDirectoryName(destination);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        if (!File.Exists(destination))
            File.Move(source, destination);
    }

    internal static string RewriteAudioFilePathLine(string markdown, string legacyRecordings, string recordings)
    {
        const string prefix = "audioFilePath: ";
        var lines = markdown.Replace("\r\n", "\n").Split('\n');
        var changed = false;
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (!line.StartsWith(prefix, StringComparison.Ordinal))
                continue;

            var audioPath = line[prefix.Length..].Trim();
            if (!IsUnder(audioPath, legacyRecordings))
                break;

            lines[i] = prefix + Path.Combine(recordings, Path.GetFileName(audioPath));
            changed = true;
            break;
        }

        return changed ? string.Join('\n', lines) : markdown;
    }

    private static bool IsUnder(string? path, string directory)
    {
        if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(directory))
            return false;

        var fullPath = Path.GetFullPath(path);
        var fullDirectory = Path.GetFullPath(directory)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        return fullPath.StartsWith(fullDirectory, StringComparison.OrdinalIgnoreCase);
    }

    private static bool PathsEqual(string left, string right) =>
        string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);

    private static void TryDeleteEmptyDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any())
                Directory.Delete(path);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }
}
