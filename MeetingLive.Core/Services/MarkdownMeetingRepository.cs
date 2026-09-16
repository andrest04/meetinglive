using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Persists each <see cref="MeetingRecord"/> as Markdown + sibling WAV under
/// <see cref="AppPaths.UserDataDirectory"/>, mirroring Library folders on disk.
/// Lookups walk the tree by the <c>id</c> frontmatter field. The optional
/// constructor argument overrides the library root so tests never write into
/// the user's real Documents folder.
/// Markdown rendering/parsing is delegated to <see cref="MeetingMarkdownFormatter"/>,
/// which changes for format reasons independent of this class's file-layout logic.
/// </summary>
public sealed class MarkdownMeetingRepository : IMeetingRepository
{
    private readonly string _rootDirectory;
    private readonly IFolderRepository _folders;

    public MarkdownMeetingRepository(string? rootDirectory = null, IFolderRepository? folders = null)
    {
        _rootDirectory = rootDirectory ?? AppPaths.UserDataDirectory;
        _folders = folders ?? new JsonFolderRepository(Path.Combine(_rootDirectory, "folders.json"));
    }

    public async Task<IReadOnlyList<MeetingRecord>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(_rootDirectory))
            return [];

        var byId = new Dictionary<Guid, MeetingRecord>();
        foreach (var path in Directory.EnumerateFiles(_rootDirectory, "*.md", SearchOption.AllDirectories))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var markdown = await File.ReadAllTextAsync(path, cancellationToken);
                var record = MeetingMarkdownFormatter.Parse(path, markdown);
                if (!byId.TryGetValue(record.Id, out var existing) ||
                    (IsLegacyFlatDump(existing.SourcePath) && !IsLegacyFlatDump(path)))
                {
                    byId[record.Id] = record;
                }
            }
            catch (Exception ex) when (ex is FormatException or IOException or UnauthorizedAccessException)
            {
                // One corrupt or unreadable file must not hide the rest of History.
            }
        }

        return [.. byId.Values];
    }

    public async Task<MeetingRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var path = FindMarkdownPath(id);
        if (path is null)
            return null;

        var markdown = await File.ReadAllTextAsync(path, cancellationToken);
        return MeetingMarkdownFormatter.Parse(path, markdown);
    }

    public async Task SaveAsync(MeetingRecord record, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(record);

        var folders = await _folders.GetAllAsync(cancellationToken);
        var directory = MeetingLibraryLayout.DirectoryFor(_rootDirectory, folders, record.FolderId);
        var desiredStem = MeetingLibraryLayout.FileStem(record.RecordedAt, record.Title);
        var stem = MeetingLibraryLayout.AllocateFileStem(directory, desiredStem, record.Id, TryReadId);
        var markdownPath = MeetingLibraryLayout.MarkdownPath(directory, stem);
        var audioPath = MeetingLibraryLayout.AudioPath(directory, stem);

        var existingMarkdown = FindMarkdownPath(record.Id);
        var existingAudio = record.AudioFilePath;
        if (string.IsNullOrWhiteSpace(existingAudio) && existingMarkdown is not null)
            existingAudio = Path.ChangeExtension(existingMarkdown, ".wav");

        MeetingLibraryLayout.MoveFileIfNeeded(existingAudio, audioPath);
        if (File.Exists(audioPath))
            record.AudioFilePath = audioPath;

        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(markdownPath, MeetingMarkdownFormatter.Render(record), cancellationToken);

        if (existingMarkdown is not null &&
            !MeetingLibraryLayout.PathsEqual(existingMarkdown, markdownPath) &&
            File.Exists(existingMarkdown))
        {
            File.Delete(existingMarkdown);
        }
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var path = FindMarkdownPath(id);
        string? audioFilePath = null;
        if (path is not null && File.Exists(path))
        {
            var markdown = await File.ReadAllTextAsync(path, cancellationToken);
            audioFilePath = MeetingMarkdownFormatter.Parse(path, markdown).AudioFilePath;
            File.Delete(path);
            var sibling = Path.ChangeExtension(path, ".wav");
            if (File.Exists(sibling))
                File.Delete(sibling);
        }

        if (!string.IsNullOrWhiteSpace(audioFilePath) && File.Exists(audioFilePath))
            File.Delete(audioFilePath);
    }

    private string? FindMarkdownPath(Guid id)
    {
        if (!Directory.Exists(_rootDirectory))
            return null;

        string? fallback = null;
        foreach (var path in Directory.EnumerateFiles(_rootDirectory, "*.md", SearchOption.AllDirectories))
        {
            if (TryReadId(path) != id)
                continue;

            if (!IsLegacyFlatDump(path))
                return path;

            fallback = path;
        }

        return fallback;
    }

    private Guid? TryReadId(string markdownPath)
    {
        try
        {
            return MeetingMarkdownFormatter.Parse(markdownPath, File.ReadAllText(markdownPath)).Id;
        }
        catch (Exception ex) when (ex is FormatException or IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private bool IsLegacyFlatDump(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return false;

        var relative = Path.GetRelativePath(_rootDirectory, path);
        var slash = relative.IndexOfAny(['\\', '/']);
        var first = slash < 0 ? relative : relative[..slash];
        return first.Equals("Meetings", StringComparison.OrdinalIgnoreCase)
            || first.Equals("Recordings", StringComparison.OrdinalIgnoreCase);
    }
}
