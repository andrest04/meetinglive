using System.Text.Json;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>Simple JSON-file-backed settings store — no SQLite needed yet.</summary>
public sealed class AppSettingsService : IAppSettingsService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    // Several ViewModels read-modify-write the same settings.json independently (e.g. Settings page
    // load racing a toggle's save reacting to that same load). Without this, two concurrent
    // File.Create calls throw IOException "used by another process" and crash the app.
    private static readonly SemaphoreSlim FileLock = new(1, 1);

    public async Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        await FileLock.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(AppPaths.SettingsFilePath))
                return new AppSettings();

            await using var stream = File.OpenRead(AppPaths.SettingsFilePath);
            var settings = await JsonSerializer.DeserializeAsync<AppSettings>(stream, JsonOptions, cancellationToken);
            return settings ?? new AppSettings();
        }
        finally
        {
            FileLock.Release();
        }
    }

    public async Task SaveAsync(AppSettings settings, CancellationToken cancellationToken = default)
    {
        await FileLock.WaitAsync(cancellationToken);
        try
        {
            AppPaths.EnsureDirectoriesExist();
            await using var stream = File.Create(AppPaths.SettingsFilePath);
            await JsonSerializer.SerializeAsync(stream, settings, JsonOptions, cancellationToken);
        }
        finally
        {
            FileLock.Release();
        }
    }
}
