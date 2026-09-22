using System.Text.Json;
using System.Text.Json.Serialization;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// JSON-file-backed chat thread store. The optional constructor argument overrides the
/// file path so tests never write into the user's real %LOCALAPPDATA%\MeetingLive data.
/// This store does not mirror folders on disk — threads are private app data.
/// </summary>
public sealed class JsonChatThreadRepository : IChatThreadRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly SemaphoreSlim _fileLock = new(1, 1);
    private readonly string _threadsFilePath;

    public JsonChatThreadRepository(string? threadsFilePath = null)
    {
        _threadsFilePath = threadsFilePath ?? AppPaths.ChatThreadsFilePath;
    }

    public async Task<IReadOnlyList<ChatThread>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            var threads = await ReadAllUnlockedAsync(cancellationToken);
            return threads
                .OrderByDescending(thread => thread.UpdatedAt)
                .ThenByDescending(thread => thread.CreatedAt)
                .ThenByDescending(thread => thread.Id)
                .ToList();
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task<ChatThread?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var threads = await GetAllAsync(cancellationToken);
        return threads.FirstOrDefault(thread => thread.Id == id);
    }

    public async Task SaveAsync(ChatThread thread, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(thread);

        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            var threads = await ReadAllUnlockedAsync(cancellationToken);
            var index = threads.FindIndex(existing => existing.Id == thread.Id);
            if (index >= 0)
                threads[index] = thread;
            else
                threads.Add(thread);

            await WriteAllUnlockedAsync(threads, cancellationToken);
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
            var threads = await ReadAllUnlockedAsync(cancellationToken);
            if (threads.RemoveAll(thread => thread.Id == id) == 0)
                return;

            await WriteAllUnlockedAsync(threads, cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    private async Task<List<ChatThread>> ReadAllUnlockedAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_threadsFilePath))
            return [];

        await using var stream = File.OpenRead(_threadsFilePath);
        var threads = await JsonSerializer.DeserializeAsync<List<ChatThread>>(stream, JsonOptions, cancellationToken);
        if (threads is null)
            return [];

        foreach (var thread in threads)
        {
            if (thread is null)
                continue;
            thread.Messages ??= [];
        }

        return threads;
    }

    private async Task WriteAllUnlockedAsync(List<ChatThread> threads, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(_threadsFilePath);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        await using var stream = File.Create(_threadsFilePath);
        await JsonSerializer.SerializeAsync(stream, threads, JsonOptions, cancellationToken);
    }
}
