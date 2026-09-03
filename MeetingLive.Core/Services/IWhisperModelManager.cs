namespace MeetingLive.Core.Services;

/// <summary>
/// On-disk lifecycle of the Whisper GGML: resolve path, download with progress,
/// and delete to reclaim disk. Mirrors <see cref="INemotronModelManager"/>.
/// </summary>
public interface IWhisperModelManager
{
    string GetModelPath();

    bool IsModelDownloaded();

    Task DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default);

    void DeleteModel();
}
