using System.Text.Json;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// JSON-file-backed folder store. The optional constructor argument overrides the
/// file path so tests never write into the user's real %LOCALAPPDATA%\MeetingLive data.
/// </summary>
public sealed class JsonFolderRepository : IFolderRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly SemaphoreSlim _fileLock = new(1, 1);
    private readonly string _foldersFilePath;

    public JsonFolderRepository(string? foldersFilePath = null)
    {
        _foldersFilePath = foldersFilePath ?? AppPaths.FoldersFilePath;
    }

    public async Task<IReadOnlyList<FolderRecord>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            return await ReadAllUnlockedAsync(cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task<FolderRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var folders = await GetAllAsync(cancellationToken);
        return folders.FirstOrDefault(folder => folder.Id == id);
    }

    public async Task SaveAsync(FolderRecord folder, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(folder);

        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            var folders = await ReadAllUnlockedAsync(cancellationToken);
            var index = folders.FindIndex(existing => existing.Id == folder.Id);
            if (index >= 0)
                folders[index] = folder;
            else
                folders.Add(folder);

            await WriteAllUnlockedAsync(folders, cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            var folders = await ReadAllUnlockedAsync(cancellationToken);
            if (folders.RemoveAll(folder => folder.Id == id) == 0)
                return;

            await WriteAllUnlockedAsync(folders, cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    private async Task<List<FolderRecord>> ReadAllUnlockedAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_foldersFilePath))
            return [];

        await using var stream = File.OpenRead(_foldersFilePath);
        var folders = await JsonSerializer.DeserializeAsync<List<FolderRecord>>(stream, JsonOptions, cancellationToken);
        return folders ?? [];
    }

    private async Task WriteAllUnlockedAsync(List<FolderRecord> folders, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(_foldersFilePath);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        await using var stream = File.Create(_foldersFilePath);
        await JsonSerializer.SerializeAsync(stream, folders, JsonOptions, cancellationToken);
    }
}
