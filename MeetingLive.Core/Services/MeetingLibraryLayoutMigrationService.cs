using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Moves legacy <c>{guid}.md</c> / <c>{guid}.wav</c> dumps into Library folders
/// with dated titles, keeping markdown and audio side by side.
/// </summary>
public sealed class MeetingLibraryLayoutMigrationService
{
    private readonly string _rootDirectory;
    private readonly string _leftoverMeetingsDirectory;
    private readonly string _leftoverRecordingsDirectory;
    private readonly IFolderRepository _folders;
    private readonly IMeetingRepository _meetings;

    public MeetingLibraryLayoutMigrationService()
        : this(
            AppPaths.UserDataDirectory,
            AppPaths.MeetingsDirectory,
            AppPaths.RecordingsDirectory,
            new JsonFolderRepository(),
            new MarkdownMeetingRepository())
    {
    }

    internal MeetingLibraryLayoutMigrationService(
        string rootDirectory,
        string leftoverMeetingsDirectory,
        string leftoverRecordingsDirectory,
        IFolderRepository folders,
        IMeetingRepository meetings)
    {
        _rootDirectory = rootDirectory;
        _leftoverMeetingsDirectory = leftoverMeetingsDirectory;
        _leftoverRecordingsDirectory = leftoverRecordingsDirectory;
        _folders = folders;
        _meetings = meetings;
    }

    public async Task MigrateIfNeededAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(_leftoverMeetingsDirectory))
            return;

        var leftovers = Directory.GetFiles(_leftoverMeetingsDirectory, "*.md");
        if (leftovers.Length == 0)
        {
            TryDeleteEmptyDirectory(_leftoverMeetingsDirectory);
            TryDeleteEmptyDirectory(_leftoverRecordingsDirectory);
            return;
        }

        _ = await _folders.GetAllAsync(cancellationToken);

        foreach (var markdownPath in leftovers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            MeetingRecord record;
            try
            {
                record = MeetingMarkdownFormatter.Parse(markdownPath, await File.ReadAllTextAsync(markdownPath, cancellationToken));
            }
            catch (FormatException)
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(record.AudioFilePath) || !File.Exists(record.AudioFilePath))
            {
                var guidWav = Path.Combine(_leftoverRecordingsDirectory, record.Id.ToString("D") + ".wav");
                if (File.Exists(guidWav))
                    record.AudioFilePath = guidWav;
            }

            await _meetings.SaveAsync(record, cancellationToken);
        }

        TryDeleteEmptyDirectory(_leftoverMeetingsDirectory);
        TryDeleteEmptyDirectory(_leftoverRecordingsDirectory);
    }

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
