using System.Text.Json;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Persists <see cref="MeetingRecord"/>s as a single local JSON file — simple
/// and enough for now, no SQLite needed yet (see CLAUDE.md).
/// </summary>
public sealed class MeetingRepository : IMeetingRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly SemaphoreSlim _lock = new(1, 1);

    public async Task<IReadOnlyList<MeetingRecord>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            return await LoadAllAsync(cancellationToken);
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task<MeetingRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        var all = await GetAllAsync(cancellationToken);
        return all.FirstOrDefault(m => m.Id == id);
    }

    public async Task SaveAsync(MeetingRecord record, CancellationToken cancellationToken = default)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var all = (await LoadAllAsync(cancellationToken)).ToList();
            var index = all.FindIndex(m => m.Id == record.Id);
            if (index >= 0)
                all[index] = record;
            else
                all.Add(record);

            AppPaths.EnsureDirectoriesExist();
            await using var stream = File.Create(AppPaths.MeetingsFilePath);
            await JsonSerializer.SerializeAsync(stream, all, JsonOptions, cancellationToken);
        }
        finally
        {
            _lock.Release();
        }
    }

    private static async Task<IReadOnlyList<MeetingRecord>> LoadAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(AppPaths.MeetingsFilePath))
            return [];

        await using var stream = File.OpenRead(AppPaths.MeetingsFilePath);
        var records = await JsonSerializer.DeserializeAsync<List<MeetingRecord>>(stream, JsonOptions, cancellationToken);
        return records ?? [];
    }
}
